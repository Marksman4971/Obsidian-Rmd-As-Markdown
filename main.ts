import { App, Plugin, PluginSettingTab, Setting, TFile, Notice, Modal } from 'obsidian';

interface RMDHeaderDetectorSettings {
	showLineNumbers: boolean;
	autoScan: boolean;
}

const DEFAULT_SETTINGS: RMDHeaderDetectorSettings = {
	showLineNumbers: true,
	autoScan: false
}

interface HeaderInfo {
	level: number;
	text: string;
	line: number;
}

export default class RMDHeaderDetectorPlugin extends Plugin {
	settings: RMDHeaderDetectorSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: 'detect-rmd-headers',
			name: '检测RMD标题',
			callback: () => {
				this.detectHeaders();
			}
		});

		this.addCommand({
			id: 'show-header-structure',
			name: '显示标题结构',
			callback: () => {
				this.showHeaderStructure();
			}
		});

		this.addSettingTab(new RMDHeaderDetectorSettingTab(this.app, this));

		if (this.settings.autoScan) {
			this.registerEvent(
				this.app.workspace.on('file-open', (file) => {
					if (file && this.isRmdFile(file)) {
						setTimeout(() => this.detectHeaders(), 1000);
					}
				})
			);
		}
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	isRmdFile(file: TFile): boolean {
		return file.extension === 'rmd' || file.extension === 'Rmd';
	}

	async detectHeaders() {
		const activeFile = this.app.workspace.getActiveFile();
		
		if (!activeFile) {
			new Notice('没有打开的文件');
			return;
		}

		if (!this.isRmdFile(activeFile)) {
			new Notice('当前文件不是RMD文档');
			return;
		}

		try {
			const content = await this.app.vault.read(activeFile);
			const headers = this.parseHeaders(content);
			
			if (headers.length === 0) {
				new Notice('未找到标题');
				return;
			}

			new Notice(`检测到 ${headers.length} 个标题`);
			console.log('RMD Headers:', headers);
		} catch (error) {
			new Notice('读取文件失败: ' + error.message);
		}
	}

	parseHeaders(content: string): HeaderInfo[] {
		const lines = content.split('\n');
		const headers: HeaderInfo[] = [];
		const headerRegex = /^(#+)\s+(.+)$/;

		lines.forEach((line, index) => {
			const match = line.match(headerRegex);
			if (match) {
				headers.push({
					level: match[1].length,
					text: match[2].trim(),
					line: index + 1
				});
			}
		});

		return headers;
	}

	async showHeaderStructure() {
		const activeFile = this.app.workspace.getActiveFile();
		
		if (!activeFile) {
			new Notice('没有打开的文件');
			return;
		}

		if (!this.isRmdFile(activeFile)) {
			new Notice('当前文件不是RMD文档');
			return;
		}

		try {
			const content = await this.app.vault.read(activeFile);
			const headers = this.parseHeaders(content);
			
			if (headers.length === 0) {
				new Notice('未找到标题');
				return;
			}

			let structure = `文件: ${activeFile.name}\n标题结构:\n\n`;
			
			headers.forEach(header => {
				const indent = '  '.repeat(header.level - 1);
				const lineInfo = this.settings.showLineNumbers ? ` (行${header.line})` : '';
				structure += `${indent}${'#'.repeat(header.level)} ${header.text}${lineInfo}\n`;
			});

			const modal = new HeaderStructureModal(this.app, structure);
			modal.open();
		} catch (error) {
			new Notice('处理文件失败: ' + error.message);
		}
	}
}

class HeaderStructureModal extends Modal {
	content: string;

	constructor(app: App, content: string) {
		super(app);
		this.content = content;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'RMD标题结构' });
		
		const pre = contentEl.createEl('pre', { cls: 'rmd-header-structure-display' });
		pre.textContent = this.content;
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class RMDHeaderDetectorSettingTab extends PluginSettingTab {
	plugin: RMDHeaderDetectorPlugin;

	constructor(app: App, plugin: RMDHeaderDetectorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'RMD Header Detector 设置' });

		new Setting(containerEl)
			.setName('显示行号')
			.setDesc('在标题结构中显示行号')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showLineNumbers)
				.onChange(async (value) => {
					this.plugin.settings.showLineNumbers = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('自动扫描')
			.setDesc('打开RMD文件时自动检测标题')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoScan)
				.onChange(async (value) => {
					this.plugin.settings.autoScan = value;
					await this.plugin.saveSettings();
				}));
	}
}