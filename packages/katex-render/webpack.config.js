// webpack.config.js — production bundle for the portable KaTeX renderer.
//
// Output is a UMD library (`KaTeXRender`) plus an extracted stylesheet and the
// KaTeX web fonts, so any page can render maths with two tags and no build step
// of its own.

const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
  mode: 'production',
  entry: './src/entry.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'katex-render.min.js',
    library: {
      type: 'umd',
      name: 'KaTeXRender',
    },
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              transpileOnly: false,
              // Type-check the bundle's own graph only. Without this ts-loader
              // pulls in every file the tsconfig `include` covers — the Jest
              // suite included — and the browser build fails on test globals.
              onlyCompileBundledFiles: true,
              compilerOptions: {
                target: 'ES2020',
                module: 'ESNext',
                moduleResolution: 'node',
                strict: true,
                esModuleInterop: true,
                skipLibCheck: true,
                forceConsistentCasingInFileNames: true,
                noEmit: false,
                declaration: true,
                declarationDir: './types',
              },
            },
          },
        ],
        exclude: [/node_modules/, /__tests__/],
      },
      {
        test: /\.css$/,
        use: [
          MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options: {
              sourceMap: false,
              importLoaders: 1,
            },
          },
        ],
      },
      {
        test: /\.(woff2?|ttf|eot|svg)$/,
        type: 'asset/resource',
        generator: {
          filename: 'fonts/[name].[contenthash:8][ext]',
        },
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({
      filename: 'katex-render.css',
    }),
  ],
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          ecma: 2020,
          compress: {
            drop_console: true,
            passes: 3,
            // `unsafe` is deliberately NOT enabled: it rewrites comparisons and
            // method calls in ways that can change behaviour, and this bundle
            // hands sanitised HTML to innerHTML. A few hundred bytes are not
            // worth loosening the guarantee the sanitiser is there to provide.
            unsafe: false,
          },
          output: {
            comments: false,
          },
        },
        extractComments: false,
      }),
    ],
    sideEffects: true,
    usedExports: true,
  },
  performance: {
    hints: 'warning',
    maxEntrypointSize: 512000,
    maxAssetSize: 512000,
  },
};
