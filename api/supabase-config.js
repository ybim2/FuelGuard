(function () {
  const DEFAULT_PROJECT_URL = "https://kwnfbdoxppiajrnkejjk.supabase.co";

  function browserFallback() {
    window.FUEL_GUARD_SUPABASE_CONFIG = window.FUEL_GUARD_SUPABASE_CONFIG || Object.freeze({
      url: "",
      anonKey: ""
    });
  }

  function publicConfigFromEnv(env) {
    return {
      url:
        env.VITE_SUPABASE_URL ||
        env.FUEL_GUARD_SUPABASE_URL ||
        env.SUPABASE_URL ||
        env.NEXT_PUBLIC_SUPABASE_URL ||
        DEFAULT_PROJECT_URL,
      anonKey:
        env.VITE_SUPABASE_ANON_KEY ||
        env.FUEL_GUARD_SUPABASE_ANON_KEY ||
        env.FUEL_GUARD_SUPABASE_PUBLISHABLE_KEY ||
        env.SUPABASE_ANON_KEY ||
        env.SUPABASE_PUBLISHABLE_KEY ||
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
        env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        ""
    };
  }

  function asScript(config) {
    return `window.FUEL_GUARD_SUPABASE_CONFIG = Object.freeze(${JSON.stringify(config)});\n`;
  }

  if (typeof window !== "undefined") {
    browserFallback();
    return;
  }

  if (typeof module !== "undefined") {
    module.exports = function supabaseConfigHandler(_request, response) {
      response.setHeader("Content-Type", "application/javascript; charset=utf-8");
      response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      response.statusCode = 200;
      response.end(asScript(publicConfigFromEnv(process.env || {})));
    };
  }
})();
