# RMD as Markdown

An Obsidian plugin that maps RMD (R Markdown) files to be opened as Markdown in Obsidian, with an enhanced outline view.

## Features

- **File Mapping**: Automatically opens `.rmd` files as Markdown in Obsidian
- **Enhanced Outline View**: Custom outline sidebar with hierarchical header display
- **Search & Navigation**: Search headers and click to jump to any header
- **Collapsible Headers**: Expand/collapse header sections with visual feedback
- **Code Block Awareness**: Properly parses headers while ignoring those inside code blocks
- **Real-time Updates**: Automatically refreshes when file content changes

## Usage

1. Install and enable the plugin in Obsidian
2. Open any `.rmd` file - it will automatically be treated as Markdown
3. Use the command "打开RMD大纲视图" to open the enhanced outline view
4. Navigate headers by clicking, search using the search box, or use the collapse/expand controls

## Installation

### Manual Installation
1. Download or clone this repository
2. Copy the plugin folder to your Obsidian vault's `.obsidian/plugins/` directory
3. Enable the plugin in Obsidian Settings > Community Plugins

### From Obsidian Community Plugins
*Coming soon - this plugin is not yet available in the community plugin directory*

## Development

```bash
npm install
npm run dev
```

## Building

```bash
npm install
npm run build
```

## License

MIT