const path = require('path')
const TerserPlugin = require('terser-webpack-plugin')

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production'
  const isWatch = argv.watch || false

  return {
    mode: isProduction ? 'production' : 'development',
    watch: isWatch,
    entry: {
      index: './src/js/index.ts',
      accordion: './src/js/plugins/accordion/index.ts',
      carousel: './src/js/plugins/carousel/index.ts',
      collapse: './src/js/plugins/collapse/index.ts',
      combobox: './src/js/plugins/combobox/index.ts',
      'copy-markup': './src/js/plugins/copy-markup/index.ts',
      dropdown: './src/js/plugins/dropdown/index.ts',
      'file-upload': './src/js/plugins/file-upload/index.ts',
      'input-number': './src/js/plugins/input-number/index.ts',
      overlay: './src/js/plugins/overlay/index.ts',
      'pin-input': './src/js/plugins/pin-input/index.ts',
      'remove-element': './src/js/plugins/remove-element/index.ts',
      scrollspy: './src/js/plugins/scrollspy/index.ts',
      select: './src/js/plugins/select/index.ts',
      stepper: './src/js/plugins/stepper/index.ts',
      'strong-password': './src/js/plugins/strong-password/index.ts',
      tabs: './src/js/plugins/tabs/index.ts',
      'toggle-count': './src/js/plugins/toggle-count/index.ts',
      'toggle-password': './src/js/plugins/toggle-password/index.ts',
      tooltip: './src/js/plugins/tooltip/index.ts'
    },
    module: {
      rules: [
        { test: /\.ts?$/, enforce: 'pre', use: ['source-map-loader'] },
        { test: /\.ts?$/, use: 'ts-loader', exclude: /node_modules/ }
      ]
    },
    resolve: { extensions: ['.ts', '.js'] },
    output: {
      path: path.resolve(__dirname, 'dist/js/'),
      filename: '[name].js',
      library: { type: 'umd' }
    },
    externals: {
      jquery: 'jQuery',
      lodash: '_',
      dropzone: 'Dropzone'
    },
    optimization: {
      minimize: true,
      minimizer: [
        new TerserPlugin({
          extractComments: false
        })
      ]
    }
  }
}