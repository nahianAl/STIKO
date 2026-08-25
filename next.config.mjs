/** @type {import('next').NextConfig} */
const nextConfig = {
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
