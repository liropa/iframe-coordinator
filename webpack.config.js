module.exports = [{
  mode: "none",
  entry: {
    index: "./src/index.ts",
    client: "./src/client.ts",
    host: "./src/host.ts"
  },
  output: {
    libraryTarget: "umd",
    filename: "[name].js",
    path: __dirname + ""
  },
  module: {
    rules: [
      {
        test: /\.worker\.(js|ts)$/,
        exclude: [/node_modules/],
        use: {
          loader: "worker-loader",
          options: {
            inline: true,
            fallback: false
          }
        }
      },
      {
        test: /\.ts$/,
        exclude: [/node_modules/],
        use: {
          loader: "ts-loader"
        }
      }
    ]
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"]
  }
}, {
  mode: "none",
  entry: {
    BackgroundClient: "./src/BackgroundClient.ts"
  },
  target: 'webworker',
  output: {
    library: '[name]',
    libraryTarget: 'umd',
    filename: "[name].js",
    path: __dirname + ""
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: [/node_modules/],
        use: {
          loader: "ts-loader"
        }
      }
    ]
  },
  resolve: {
    extensions: [".ts", ".js"]
  }
}];
