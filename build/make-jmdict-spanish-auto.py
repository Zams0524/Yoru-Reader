"""Builds public/dictionaries/JMdict_spanish_auto.zip: the words of the bundled English JMdict that the
Spanish JMdict does not have, with their meanings machine-translated from English into Spanish.

Why: the Spanish JMdict has ~34 000 entries; the English one we ship has ~61 000 (common words plus the
60 000 most frequent words in novels). Words such as こみ上げる were only in English, and the popup
showed them in English. This dictionary fills that gap, offline, and its name says it is a machine
translation so the reader knows where the text comes from.

How:
- An entry is "missing" when its JMdict sequence number is in JMdict_english.zip but not in
  JMdict_spanish.zip. `forms` rows (the table of spellings) are skipped: the popup ignores them.
- Only the meaning texts are translated (glossary, info notes and the glosses of cross references).
  Japanese links, tags and the structure of each entry are kept as they are.
- "to <verb>" glosses are sent as "How to <verb>" and the "Cómo" is taken off afterwards: the
  model then answers with a Spanish infinitive ("surgir") instead of "para surgir" / "a surgir".
- Lists such as 'dense; thick; crowded' are translated one meaning at a time (and repeated
  translations dropped), and letters with macrons (Hachikō) are sent without them.
- build/jmdict-es-correcciones.json holds hand corrections ({"English": "español"}) that win over
  the model; add one whenever a frequent word comes out wrong.
- Translations are cached in a JSON file, so running it again only translates what is new.

Model: OPUS-MT tc-big en-es (Helsinki-NLP, CC BY 4.0), converted to CTranslate2. It runs on the CPU
with no internet; ~70 000 glosses take about 20 minutes on 4 cores.

Usage:
  pip install ctranslate2 sentencepiece transformers torch
  # https://huggingface.co/Helsinki-NLP/opus-mt-tc-big-en-es -> ./opus-mt-tc-big-en-es
  ct2-transformers-converter --model opus-mt-tc-big-en-es --output_dir opus-ct2 --quantization int8
  python build/make-jmdict-spanish-auto.py --model opus-ct2 --spm opus-mt-tc-big-en-es \
      [--cache translations-cache.json] [--out public/dictionaries/JMdict_spanish_auto.zip]
"""
import argparse
import datetime
import json
import os
import re
import sys
import zipfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
TRANSLATED_CONTEXTS = {'glossary', 'infoGlossary', 'refGlosses', 'notes', 'TOP'}
JAPANESE = re.compile('[\u3040-\u30ff\u3400-\u9fff]')
OVERRIDES = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'jmdict-es-correcciones.json')
# Fixed labels inside entries: not worth the model, and it gets them wrong without context.
FIXED = {'see: ': 'ver: ', 'antonym: ': 'antónimo: '}
LANGUAGES = {
    'English': 'Inglés', 'English (wasei)': 'Inglés (wasei)', 'French': 'Francés', 'German': 'Alemán',
    'Italian': 'Italiano', 'Portuguese': 'Portugués', 'Spanish': 'Español', 'Dutch': 'Neerlandés',
    'Russian': 'Ruso', 'Chinese': 'Chino', 'Korean': 'Coreano', 'Latin': 'Latín', 'Sanskrit': 'Sánscrito',
    'Arabic': 'Árabe', 'Ancient Greek': 'Griego antiguo', 'Modern Greek': 'Griego moderno', 'Greek': 'Griego',
    'Ainu': 'Ainu', 'Hindi': 'Hindi', 'Malay': 'Malayo', 'Mongolian': 'Mongol', 'Persian': 'Persa',
    'Polish': 'Polaco', 'Swedish': 'Sueco', 'Thai': 'Tailandés', 'Tibetan': 'Tibetano', 'Turkish': 'Turco',
    'Vietnamese': 'Vietnamita', 'Indonesian': 'Indonesio', 'Hebrew': 'Hebreo', 'Hungarian': 'Húngaro',
    'Finnish': 'Finés', 'Norwegian': 'Noruego', 'Danish': 'Danés', 'Czech': 'Checo', 'Tagalog': 'Tagalo',
    'Burmese': 'Birmano', 'Manchu': 'Manchú', 'Swahili': 'Suajili', 'Khmer': 'Jemer', 'Tamil': 'Tamil',
}


def load_rows(zip_path):
    with zipfile.ZipFile(zip_path) as z:
        names = sorted((n for n in z.namelist() if re.match(r'term_bank_\d+\.json$', n)),
                       key=lambda n: int(re.search(r'(\d+)', n).group(1)))
        rows = []
        for name in names:
            rows += json.loads(z.read(name))
        tags = json.loads(z.read('tag_bank_1.json')) if 'tag_bank_1.json' in z.namelist() else []
        index = json.loads(z.read('index.json'))
    return rows, tags, index


def walk(node, ctx, fn):
    """Copies a glossary node, passing every text through fn(context, text)."""
    if isinstance(node, str):
        return fn(ctx, node)
    if isinstance(node, list):
        return [walk(x, ctx, fn) for x in node]
    if isinstance(node, dict):
        if node.get('type') == 'structured-content':
            return {**node, 'content': walk(node['content'], ctx, fn)}
        if node.get('type') == 'text':
            return {**node, 'text': fn(ctx, node['text'])}
        own = (node.get('data') or {}).get('content')
        # Japanese links and text stay; JMdict marks its notes list as 'ja' too, but they are English.
        if node.get('tag') == 'a' or (node.get('lang') == 'ja' and own != 'notes'):
            return node
        out = dict(node)
        if out.get('lang') == 'en':
            out['lang'] = 'es'
        if 'content' in out:
            out['content'] = walk(node['content'], own or ctx, fn)
        return out
    return node


def split(text):
    """(' 1. ', 'core text', '') — cross references start with a space and sometimes a number."""
    m = re.match(r'^(\s*(?:\d+\.\s*)?)(.*?)(\s*)$', text, re.S)
    return m.group(1), m.group(2), m.group(3)


def parts(core):
    """'dense; thick; crowded' is three meanings: translated one by one, or the model writes
    'denso; denso; denso'."""
    return [p for p in core.split('; ') if p]


MACRONS = str.maketrans('āīūēōĀĪŪĒŌ', 'aiueoAIUEO')


def translatable(ctx, text):
    # Notes with Japanese in them ("esp. かぜくも") are left alone: the model mangles the kana.
    if ctx == 'notes' and JAPANESE.search(text):
        return False
    return ctx in TRANSLATED_CONTEXTS and re.search('[A-Za-z]', text) and text not in FIXED



def tidy(source, out):
    out = out.strip()
    if source.startswith('to '):
        without = re.sub(r'^¿?\s*[Cc]ómo\s+', '', out)
        out = without if without != out else re.sub(r'^(para|Para|a|A)\s+', '', out)
        out = out.rstrip('?').rstrip()
    if not source.startswith('?'):
        out = out.lstrip('¿')
    if out.endswith('?') and not source.endswith('?'):
        out = out[:-1]
    if out.endswith('.') and not source.endswith('.'):
        out = out[:-1]
    if source[:1].islower() and out[:1].isupper():
        out = out[0].lower() + out[1:]
    return out


def translate_all(texts, model_dir, spm_dir, cache, cache_path):
    import ctranslate2
    import sentencepiece as spm
    translator = ctranslate2.Translator(model_dir, device='cpu', inter_threads=1, intra_threads=os.cpu_count() or 4)
    src = spm.SentencePieceProcessor(model_file=os.path.join(spm_dir, 'source.spm'))
    tgt = spm.SentencePieceProcessor(model_file=os.path.join(spm_dir, 'target.spm'))
    todo = [t for t in texts if t not in cache]
    print(f'{len(texts)} texts, {len(todo)} to translate', flush=True)
    for i in range(0, len(todo), 256):
        chunk = todo[i:i + 256]
        prompts = [(('How ' + t) if t.startswith('to ') else t).translate(MACRONS) for t in chunk]
        results = translator.translate_batch([src.encode(p, out_type=str) + ['</s>'] for p in prompts],
                                             beam_size=4, max_batch_size=64)
        for text, result in zip(chunk, results):
            out = tidy(text, tgt.decode(result.hypotheses[0]))
            cache[text] = text if '⁇' in out else out
        if (i // 256) % 20 == 0:
            print(f'  {i + len(chunk)}/{len(todo)}', flush=True)
            json.dump(cache, open(cache_path, 'w', encoding='utf-8'), ensure_ascii=False)
    json.dump(cache, open(cache_path, 'w', encoding='utf-8'), ensure_ascii=False)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--english', default=os.path.join(ROOT, 'public/dictionaries/JMdict_english.zip'))
    parser.add_argument('--spanish', default=os.path.join(ROOT, 'public/dictionaries/JMdict_spanish.zip'))
    parser.add_argument('--out', default=os.path.join(ROOT, 'public/dictionaries/JMdict_spanish_auto.zip'))
    parser.add_argument('--cache', default='translations-cache.json')
    parser.add_argument('--model', help='CTranslate2 model folder (only needed for texts not in the cache)')
    parser.add_argument('--spm', help='folder with source.spm and target.spm')
    args = parser.parse_args()

    english, tags, english_index = load_rows(args.english)
    spanish, _, _ = load_rows(args.spanish)
    in_spanish = {row[6] for row in spanish}
    missing = [row for row in english if row[6] not in in_spanish and 'forms' not in row[2].split()]

    texts = set()

    def collect(ctx, text):
        if translatable(ctx, text):
            core = split(text)[1]
            texts.update(parts(core))
        return text

    for row in missing:
        for gloss in row[5]:
            walk(gloss, 'TOP' if isinstance(gloss, str) else None, collect)

    cache = json.load(open(args.cache, encoding='utf-8')) if os.path.exists(args.cache) else {}
    # '⁇' is what the model writes for letters it does not know (Hachikō -> Hachik ⁇): try again.
    cache = {k: v for k, v in cache.items() if '⁇' not in v}
    # Hand corrections win over the model: {"English gloss": "glosa en español"}.
    overrides = json.load(open(OVERRIDES, encoding='utf-8')) if os.path.exists(OVERRIDES) else {}
    if any(t not in cache and t not in overrides for t in texts):
        if not args.model or not args.spm:
            sys.exit('Some texts are not in the cache: pass --model and --spm to translate them.')
        translate_all(sorted(t for t in texts if t not in overrides), args.model, args.spm, cache, args.cache)
    cache = {**cache, **overrides}

    def to_spanish(ctx, text):
        if text in FIXED:
            return FIXED[text]
        if ctx == 'sourceLanguages':
            m = re.match(r'^(.*?)(: )?$', text)
            name = LANGUAGES.get(m.group(1))
            return name + (m.group(2) or '') if name else text
        if not translatable(ctx, text):
            return text
        before, core, after = split(text)
        if not core:
            return text
        seen = []
        for part in parts(core):
            spanish = cache.get(part, part)
            if spanish not in seen:
                seen.append(spanish)
        return before + '; '.join(seen) + after

    rows = []
    for row in missing:
        out = list(row)
        out[5] = [walk(g, 'TOP' if isinstance(g, str) else None, to_spanish) for g in row[5]]
        rows.append(out)

    today = datetime.date.today().isoformat()
    index = {
        'title': f'JMdict (Spanish, traducción automática) [{today}]',
        'format': 3,
        'revision': f'{english_index.get("revision", "JMdict")}.es-auto',
        'sequenced': True,
        # Starts with 'JMdict (Spanish' so the importer does not rename it to 'JMdict (English) ...'.
        'author': 'Yoru Reader',
        'description': ('Palabras del JMdict que no están en el JMdict español, con los significados '
                        'traducidos automáticamente del inglés (OPUS-MT tc-big en-es, Helsinki-NLP, CC BY 4.0). '
                        'Puede tener errores de traducción.'),
        'attribution': ('This publication has included material from the JMdict (EDICT, etc.) dictionary files in '
                        'accordance with the licence provisions of the Electronic Dictionaries Research Group. '
                        'See http://www.edrdg.org/ — Machine translation: OPUS-MT (Tiedemann & Thottingal, 2020), CC BY 4.0. '
                        'This derived dictionary is distributed under CC BY-SA 4.0.'),
        'isUpdatable': False,
    }
    with zipfile.ZipFile(args.out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.writestr('index.json', json.dumps(index, ensure_ascii=False))
        z.writestr('tag_bank_1.json', json.dumps(tags, ensure_ascii=False))
        for i in range(0, len(rows), 10000):
            z.writestr(f'term_bank_{i // 10000 + 1}.json', json.dumps(rows[i:i + 10000], ensure_ascii=False))
    words = len({row[6] for row in rows})
    print(f'{words} words, {len(rows)} rows, {os.path.getsize(args.out) / 1e6:.1f} MB -> {args.out}')


if __name__ == '__main__':
    main()
