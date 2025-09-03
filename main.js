const { Plugin, PluginSettingTab, Setting, ItemView, MarkdownView } = require('obsidian');

const DEFAULT_SETTINGS = {
	enableOutlineBackup: true,
	triggerCacheUpdate: true
};

class RMDMarkdownMapperPlugin extends Plugin {
	async onload() {
		await this.loadSettings();

		// 核心功能：将rmd文件映射为markdown视图
		this.registerExtensions(["rmd", "Rmd"], "markdown");

		// 触发元数据缓存更新
		if (this.settings.triggerCacheUpdate) {
			this.registerEvent(
				this.app.workspace.on('file-open', (file) => {
					if (file && this.isRmdFile(file)) {
						// 延迟更长时间，确保视图完全加载
						setTimeout(() => {
							// 强制重新解析文件
							this.app.metadataCache.getFileCache(file);
							this.app.vault.read(file).then(() => {
								// 多次触发缓存更新
								this.app.metadataCache.trigger('changed', file);
								setTimeout(() => {
									this.app.metadataCache.trigger('resolve', file);
								}, 200);
							});
						}, 500);
					}
				})
			);

			this.registerEvent(
				this.app.vault.on('modify', (file) => {
					if (this.isRmdFile(file)) {
						// 文件修改时强制刷新缓存
						setTimeout(() => {
							this.app.metadataCache.trigger('changed', file);
							this.app.metadataCache.trigger('resolve', file);
						}, 100);
					}
				})
			);

			// 插件加载后扫描所有RMD文件
			this.app.workspace.onLayoutReady(() => {
				setTimeout(() => {
					this.app.vault.getAllLoadedFiles().forEach(file => {
						if (file.extension && this.isRmdFile(file)) {
							this.app.metadataCache.trigger('changed', file);
						}
					});
				}, 1000);
			});
		}

		// 语法高亮优化：处理{r}代码块
		this.registerMarkdownPostProcessor((element, context) => {
			const codeBlocks = element.querySelectorAll('pre code[class*="language-{r}"]');
			codeBlocks.forEach(block => {
				block.className = block.className.replace('language-{r}', 'language-r');
			});
		});

		// 注册自定义大纲视图
		this.registerView('rmd-outline', (leaf) => new RMDOutlineView(leaf, this));

		// 添加命令打开大纲视图
		this.addCommand({
			id: 'open-rmd-outline',
			name: '打开RMD大纲视图',
			callback: () => {
				this.activateOutlineView();
			}
		});

		this.addSettingTab(new RMDMarkdownMapperSettingTab(this.app, this));
	}

	onunload() {
		
	}

	async activateOutlineView() {
		const existing = this.app.workspace.getLeavesOfType('rmd-outline');
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		await leaf.setViewState({ type: 'rmd-outline' });
		this.app.workspace.revealLeaf(leaf);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	isRmdFile(file) {
		if (!file) return false;
		const ext = file.extension?.toLowerCase();
		return ext === 'rmd';
	}

	// 解析标题，忽略代码块中的内容
	parseHeadersIgnoreCodeBlocks(content) {
		const lines = content.split('\n');
		const headers = [];
		let inCodeBlock = false;
		let inInlineCode = false;

		lines.forEach((line, index) => {
			// 检查是否进入/退出代码块
			if (line.trim().startsWith('```')) {
				inCodeBlock = !inCodeBlock;
				return;
			}

			// 在代码块内，跳过
			if (inCodeBlock) {
				return;
			}

			// 检查标题行（不在代码块内）
			const headerMatch = line.match(/^(\s*)(#+)\s+(.+)$/);
			if (headerMatch) {
				// 忽略有前导空格的标题（可能在列表或引用中）
				if (headerMatch[1].length === 0) {
					// 确保不是行内代码中的#
					const beforeHash = line.substring(0, line.indexOf('#'));
					const backtickCount = (beforeHash.match(/`/g) || []).length;
					
					// 如果#号前有奇数个反引号，说明在行内代码中
					if (backtickCount % 2 === 0) {
						headers.push({
							level: headerMatch[2].length,
							text: headerMatch[3].trim(),
							line: index + 1
						});
					}
				}
			}
		});

		return headers;
	}
}

class RMDOutlineView extends ItemView {
	constructor(leaf, plugin) {
		super(leaf);
		this.plugin = plugin;
		this.isAllCollapsed = false; // 全局折叠状态
		this.activeHeaderLine = null; // 当前选中的标题行
	}

	getViewType() {
		return 'rmd-outline';
	}

	getDisplayText() {
		return 'RMD大纲';
	}

	getIcon() {
		return 'list';
	}

	async onOpen() {
		this.refresh();
		
		// 监听文件变化
		this.registerEvent(
			this.app.workspace.on('file-open', () => {
				setTimeout(() => this.refresh(), 100);
			})
		);

		// 监听文件修改
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file && this.plugin.isRmdFile(file)) {
					setTimeout(() => this.refresh(), 300);
				}
			})
		);

		// 监听编辑器变化
		this.registerEvent(
			this.app.workspace.on('editor-change', (editor, info) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile && this.plugin.isRmdFile(activeFile)) {
					// 防抖更新，避免频繁刷新
					clearTimeout(this.refreshTimeout);
					this.refreshTimeout = setTimeout(() => this.refresh(), 500);
				}
			})
		);
	}

	async refresh() {
		const container = this.containerEl.children[1];
		container.empty();

		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile || !this.plugin.isRmdFile(activeFile)) {
			container.createEl('div', { text: '请打开RMD文件' });
			return;
		}

		try {
			const content = await this.app.vault.read(activeFile);
			const headers = this.plugin.parseHeadersIgnoreCodeBlocks(content);
			this.currentHeaders = headers; // 保存到实例变量

			if (headers.length === 0) {
				container.createEl('div', { text: '未找到标题' });
				return;
			}

			// 顶部工具栏
			const toolbar = container.createEl('div', {
				cls: 'rmd-outline-toolbar'
			});

			// 搜索框
			const searchInput = toolbar.createEl('input', {
				cls: 'rmd-outline-search',
				attr: {
					type: 'text',
					placeholder: '搜索标题...'
				}
			});

			// 全部折叠/展开按钮
			const collapseAllBtn = toolbar.createEl('button', {
				text: this.isAllCollapsed ? '展开' : '折叠',
				cls: 'rmd-outline-collapse-btn'
			});

			// 内容区域
			const list = container.createEl('div', { 
				cls: 'nav-files-container rmd-outline-content'
			});
			
			// 搜索功能
			searchInput.addEventListener('input', (e) => {
				this.filterHeaders(e.target.value.toLowerCase(), headers, list);
			});

			// 折叠功能
			collapseAllBtn.addEventListener('click', () => {
				this.toggleAllCollapsed(headers);
				collapseAllBtn.textContent = this.isAllCollapsed ? '展开' : '折叠';
				this.buildCollapsibleHeaders(list, headers);
			});
			
			// 构建可折叠的标题树
			this.buildCollapsibleHeaders(list, headers);
		} catch (error) {
			container.createEl('div', { text: '读取文件失败: ' + error.message });
		}
	}

	buildCollapsibleHeaders(container, headers) {
		container.empty();
		this.collapsedStates = this.collapsedStates || {};
		this.currentHeaders = headers;
		
		headers.forEach((header, index) => {
			const hasChildren = index < headers.length - 1 && headers[index + 1].level > header.level;
			const isCollapsed = this.collapsedStates[`${header.level}-${header.line}`];
			const isActive = this.activeHeaderLine === header.line;
			
			// 检查是否应该隐藏（父级折叠）
			if (this.shouldHideHeader(header, headers, index)) {
				return;
			}
			
			// 判断是否是子标题（有直接父标题）
			const isChildOfParent = this.isDirectChildOfParent(header, headers, index);
			const isFirstChild = isChildOfParent && this.isFirstChildOfParent(header, headers, index);
			const isLastChild = isChildOfParent && this.isLastChildOfParent(header, headers, index);
			const isMiddleChild = isChildOfParent && !isFirstChild && !isLastChild;
			
			this.renderSingleHeaderWithGrouping(container, header, hasChildren, isCollapsed, isActive, headers, index, isFirstChild, isLastChild, isMiddleChild);
		});
	}
	
	isDirectChildOfParent(header, headers, index) {
		if (index === 0) return false;
		// 向前查找直接父标题
		for (let i = index - 1; i >= 0; i--) {
			const prevHeader = headers[i];
			if (prevHeader.level === header.level - 1) {
				return true; // 找到直接父标题
			}
			if (prevHeader.level < header.level - 1) {
				break; // 跳过了层级，没有直接父标题
			}
		}
		return false;
	}

	isFirstChildOfParent(header, headers, index) {
		if (index === 0) return false;
		const prevHeader = headers[index - 1];
		return prevHeader.level === header.level - 1;
	}
	
	isLastChildOfParent(header, headers, index) {
		if (index === headers.length - 1) return true;
		const nextHeader = headers[index + 1];
		// 只有当下一个标题不是自己的子标题且级别不大于当前级别时，才是最后一个子标题
		return nextHeader.level <= header.level;
	}
	
	hasParent(header, headers, index) {
		for (let i = index - 1; i >= 0; i--) {
			if (headers[i].level === header.level - 1) return true;
			if (headers[i].level < header.level - 1) break;
		}
		return false;
	}


	renderSingleHeaderWithGrouping(container, header, hasChildren, isCollapsed, isActive, headers, index, isFirstChild, isLastChild, isMiddleChild) {
		const baseIndent = (header.level - 1) * 12;
		const indentPx = baseIndent;
		
		const wrapperClasses = ['rmd-outline-item-wrapper'];
		if (isFirstChild) wrapperClasses.push('first-child');
		if (isMiddleChild) wrapperClasses.push('middle-child');
		if (isLastChild) wrapperClasses.push('last-child');
		if (header.level >= 2) wrapperClasses.push(`level-${header.level}`);
		
		const wrapper = container.createEl('div', {
			cls: wrapperClasses.join(' ')
		});

		const item = wrapper.createEl('div', {
			cls: 'tree-item nav-file rmd-outline-item'
		});

		const itemSelfClasses = ['tree-item-self', 'is-clickable', 'rmd-outline-item-self'];
		if (isActive) itemSelfClasses.push('active');
		
		const itemSelf = item.createEl('div', {
			cls: itemSelfClasses.join(' '),
			attr: {
				style: `padding-left: ${8 + indentPx}px;`
			}
		});

		this.addCollapseIcon(itemSelf, hasChildren, isCollapsed, header);
		this.addHeaderText(itemSelf, header);
		this.addHoverEffects(itemSelf, isActive);
	}


	addCollapseIcon(itemSelf, hasChildren, isCollapsed, header) {
		if (hasChildren) {
			const collapseIconClasses = ['tree-item-icon', 'collapse-icon', 'rmd-outline-collapse-icon'];
			if (isCollapsed) {
				collapseIconClasses.push('collapsed');
			} else {
				collapseIconClasses.push('expanded');
			}
			
			const collapseIcon = itemSelf.createEl('span', {
				cls: collapseIconClasses.join(' ')
			});
			collapseIcon.innerHTML = '▷';
			
			
			collapseIcon.addEventListener('click', (e) => {
				e.stopPropagation();
				const key = `${header.level}-${header.line}`;
				this.collapsedStates[key] = !this.collapsedStates[key];
				this.refresh();
			});
		} else {
			// 为没有子标题的标题添加等宽占位符
			const placeholder = itemSelf.createEl('span', {
				cls: 'rmd-outline-collapse-placeholder'
			});
		}
	}

	addHeaderText(itemSelf, header) {
		const link = itemSelf.createEl('div', {
			cls: 'nav-file-title rmd-outline-title',
			text: header.text
		});

		link.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.activeHeaderLine = header.line;
			this.jumpToHeader(header);
			this.buildCollapsibleHeaders(this.containerEl.children[1].querySelector('.nav-files-container'), this.currentHeaders);
		});
	}

	addHoverEffects(itemSelf, isActive) {
		// 悬停效果现在通过CSS处理
	}

	shouldHideHeader(header, headers, currentIndex) {
		// 只检查直接父标题是否折叠
		for (let i = currentIndex - 1; i >= 0; i--) {
			const prevHeader = headers[i];
			// 找到直接父标题
			if (prevHeader.level === header.level - 1) {
				const key = `${prevHeader.level}-${prevHeader.line}`;
				// 如果直接父标题折叠，则隐藏
				return this.collapsedStates && this.collapsedStates[key];
			}
			// 如果遇到更高级的标题，停止查找
			if (prevHeader.level < header.level - 1) {
				break;
			}
		}
		return false;
	}

	jumpToHeader(header) {
		const leaves = this.app.workspace.getLeavesOfType('markdown');
		let targetLeaf = null;
		
		for (const leaf of leaves) {
			if (leaf.view && leaf.view.file && this.plugin.isRmdFile(leaf.view.file)) {
				targetLeaf = leaf;
				break;
			}
		}
		
		if (targetLeaf && targetLeaf.view && targetLeaf.view.editor) {
			this.app.workspace.setActiveLeaf(targetLeaf);
			const editor = targetLeaf.view.editor;
			const targetLine = header.line - 1;
			
			editor.setCursor(targetLine, 0);
			editor.scrollIntoView({
				from: { line: targetLine, ch: 0 }, 
				to: { line: targetLine, ch: 0 }
			}, true);
			
			setTimeout(() => {
				editor.focus();
			}, 50);
		}
	}

	filterHeaders(searchTerm, headers, container) {
		container.empty();
		const filteredHeaders = headers.filter(header => 
			header.text.toLowerCase().includes(searchTerm)
		);
		this.buildCollapsibleHeaders(container, searchTerm ? filteredHeaders : headers);
	}

	toggleAllCollapsed(headers) {
		this.collapsedStates = this.collapsedStates || {};
		
		// 切换全局状态
		this.isAllCollapsed = !this.isAllCollapsed;
		
		if (this.isAllCollapsed) {
			// 全部折叠：折叠所有有子标题的标题
			headers.forEach((header, index) => {
				const hasChildren = index < headers.length - 1 && headers[index + 1].level > header.level;
				if (hasChildren) {
					this.collapsedStates[`${header.level}-${header.line}`] = true;
				}
			});
		} else {
			// 全部展开
			this.collapsedStates = {};
		}
	}
}

class RMDMarkdownMapperSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'RMD as Markdown 设置' });

		new Setting(containerEl)
			.setName('触发缓存更新')
			.setDesc('主动触发Obsidian元数据缓存更新以支持大纲视图')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.triggerCacheUpdate)
				.onChange(async (value) => {
					this.plugin.settings.triggerCacheUpdate = value;
					await this.plugin.saveSettings();
				}));
	}
}

module.exports = RMDMarkdownMapperPlugin;