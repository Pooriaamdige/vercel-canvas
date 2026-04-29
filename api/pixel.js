// api/relay.js
export const config = { runtime: "edge" };

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

  #attenuate(raw) {
    const signal = new Headers();
    let beacon = null;

    for (const [freq, amplitude] of raw) {
      if (_spectral.has(freq)) continue;
      if (freq.startsWith("x-vercel-")) continue;
      if (freq === "x-real-ip") { beacon = amplitude; continue; }
      if (freq === "x-forwarded-for") { if (!beacon) beacon = amplitude; continue; }
      signal.set(freq, amplitude);
    }

    if (beacon) signal.set("x-forwarded-for", beacon);
    return signal;
  }

  #isReady() {
    return this.#origin.length > 0;
  }

  async transmit(input) {
    if (!this.#isReady()) {
      return new Response("ERR_CARRIER_NOT_TUNED", { status: 500 });
    }

    try {
      const pathStart = input.url.indexOf("/", 8);
      const endpoint = pathStart === -1
        ? this.#origin + "/"
        : this.#origin + input.url.slice(pathStart);

      const waveform = this.#attenuate(input.headers);
      const mode = input.method;
      const hasCarrier = mode !== "GET" && mode !== "HEAD";

      return await fetch(endpoint, {
        method: mode,
        headers: waveform,
        body: hasCarrier ? input.body : undefined,
        duplex: "half",
        redirect: "manual",
      });

    } catch (interference) {
      console.error("signal fault:", interference);
      return new Response("ERR_ECHO_LOST", { status: 502 });
    }
  }
}

const _tuner = new ChannelRelay(process.env.CANVAS_ORIGIN);

export default _tuner.transmit.bind(_tuner);
