/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required by the PostHog proxy (app/ingest/[...path]/route.ts). posthog-js
  // calls slash-ended paths (/ingest/e/, /ingest/flags/, /ingest/s/); without
  // this, Next answers them with a 308 to the slashless path, and that 308 has
  // no CORS headers, so cross-origin calls from www.stiko.design fail in the
  // browser. It also disables Next's built-in `/x/` -> `/x` redirect for the
  // whole app; middleware.ts redoes that for app paths (lib/trailingSlash.ts).
  //
  // The proxy used to be three rewrites here. An external rewrite forwards the
  // browser's Cookie header (the sign-in session) and Referer to PostHog; the
  // route handler forwards an allowlist of headers only. Do not bring them back.
  skipTrailingSlashRedirect: true,
  webpack: (config, { isServer, webpack }) => {
    config.resolve.alias.canvas = false;

    // @gltf-transform/core ships NodeIO and WebIO in one bundle, and NodeIO does
    // `import("node:fs")`. Webpack parses that whether or not NodeIO is reachable, and
    // throws UnhandledSchemeError for the `node:` scheme when targeting the browser.
    // The package's own `browser` field already maps bare `fs`/`path` to false — it just
    // does not cover the prefixed form — so stripping the prefix lets that mapping win.
    //
    // Scoped to exactly `node:fs` and `node:path`. A blanket /^node:/ rule would also
    // rewrite any OTHER Node built-in a dependency drags in, turning a loud build failure
    // into a silent empty module — which is how a server-only import ends up shipped.
    if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:(fs|path)$/, (resource) => {
          resource.request = resource.request.slice('node:'.length);
        })
      );
    }

    return config;
  },
};

export default nextConfig;
