import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const ASSETS_DIR = path.resolve(ROOT_DIR, 'static', 'assets');
const OUTPUT_FILE = path.resolve(ROOT_DIR, 'src', 'lib', 'audio-catalog.json');

const CATEGORIES = ['ambience', 'music', 'sounds'];
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.ogg', '.m4a', '.flac']);

const DEFAULT_ICONS = {
	ambience: 'filter_drama',
	music: 'music_note',
	sounds: 'volume_up'
};

function parseFileName(fileName, category) {
	const ext = path.extname(fileName);
	const base = path.basename(fileName, ext);

	let title = base;
	let icon = DEFAULT_ICONS[category] || 'graphic_eq';

	if (base.includes('__')) {
		const parts = base.split('__');
		title = parts[0].trim();
		icon = parts[1].trim() || icon;
	} else if (base.includes('_')) {
		const lastIndex = base.lastIndexOf('_');
		title = base.substring(0, lastIndex).trim();
		icon = base.substring(lastIndex + 1).trim() || icon;
	}

	title = title.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
	const cleanIcon = icon.toLowerCase().replace(/[^a-z0-9_]/g, '') || DEFAULT_ICONS[category];

	return { title, icon: cleanIcon };
}

function generateCatalog() {
	const catalog = {
		ambience: [],
		music: [],
		sounds: [],
		generatedAt: new Date().toISOString()
	};

	if (!fs.existsSync(ASSETS_DIR)) {
		fs.mkdirSync(ASSETS_DIR, { recursive: true });
	}

	for (const cat of CATEGORIES) {
		const catDir = path.join(ASSETS_DIR, cat);
		if (!fs.existsSync(catDir)) {
			fs.mkdirSync(catDir, { recursive: true });
		}

		const entries = fs.readdirSync(catDir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isFile()) {
				const ext = path.extname(entry.name).toLowerCase();
				if (!AUDIO_EXTENSIONS.has(ext)) continue;

				const { title, icon } = parseFileName(entry.name, cat);
				const webPath = `/assets/${cat}/${encodeURIComponent(entry.name)}`;

				catalog[cat].push({
					id: `${cat}-${path.basename(entry.name, ext).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
					name: title,
					icon,
					file: webPath,
					fileName: entry.name,
					category: cat
				});
			}
		}

		catalog[cat].sort((a, b) => a.name.localeCompare(b.name));
	}

	const outDir = path.dirname(OUTPUT_FILE);
	if (!fs.existsSync(outDir)) {
		fs.mkdirSync(outDir, { recursive: true });
	}

	fs.writeFileSync(OUTPUT_FILE, JSON.stringify(catalog, null, '\t'), 'utf-8');
	console.log(`[audio-catalog] Generated ${catalog.ambience.length} ambience, ${catalog.music.length} music, ${catalog.sounds.length} sounds -> ${OUTPUT_FILE}`);
}

generateCatalog();
