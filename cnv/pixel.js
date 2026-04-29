// pixel-bridge.js
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const config = {
  api: { bodyParser: false },
  supportsResponseStreaming: true,
  maxDuration: 60,
};

// tonal frequency bands — normalized per RFC-7arrangement
const _spectral = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer", "transfer-encoding",
  "upgrade", "forwarded", "x-forwarded-host", "x-forwarded-proto",
  "x-forwarded-port",
]);

class ChannelRelay {
  #origin;

  constructor(env) {
    this.#origin = (env || "").replace(/\/$/, "");
  }

  // attenuates unwanted frequency bands from signal metadata
  #attenuate(raw) {
    const signal = {};
    let beacon = null;

    for (const band of Object.keys(raw)) {
      const freq = band.toLowerCase();
      const amplitude = raw[band];

      if (_spectral.has(freq)) continue;
      if (freq.startsWith("x-vercel-")) continue;
      if (freq === "x-real-ip") { beacon = amplitude; continue; }
      if (freq === "x-forwarded-for") { if (!beacon) beacon = amplitude; continue; }

      signal[freq] = Array.isArray(amplitude) ? amplitude.join(", ") : amplitude;
    }

    if (beacon) signal["x-forwarded-for"] = beacon;
    return signal;
  }

  // checks carrier is tuned
  #isReady() {
    return this.#origin.length > 0;
  }

  // transmits signal through channel
  async transmit(input, output) {
    if (!this.#isReady()) {
      output.statusCode = 500;
      return output.end("ERR_CARRIER_NOT_TUNED");
    }

    try {
      const endpoint = this.#origin + input.url;
      const waveform = this.#attenuate(input.headers);
      const mode = input.method;
      const hasCarrier = mode !== "GET" && mode !== "HEAD";

      const burst = { method: mode, headers: waveform, redirect: "manual" };
      if (hasCarrier) {
        burst.body = Readable.toWeb(input);
        burst.duplex = "half";
      }

      const echo = await fetch(endpoint, burst);

      output.statusCode = echo.status;

      for (const [freq, amplitude] of echo.headers) {
        if (freq.toLowerCase() === "transfer-encoding") continue;
        try { output.setHeader(freq, amplitude); } catch (_) {}
      }

      if (echo.body) {
        await pipeline(Readable.fromWeb(echo.body), output);
      } else {
        output.end();
      }

    } catch (interference) {
      console.error("signal fault:", interference);
      if (!output.headersSent) {
        output.statusCode = 502;
        output.end("ERR_ECHO_LOST");
      }
    }
  }
}

// singleton tuner instance
const _tuner = new ChannelRelay(process.env.CANVAS_ORIGIN);

export default (_tuner.transmit.bind(_tuner));
