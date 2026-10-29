import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Loader2, MoreVertical, Plus, Trash2, Upload, X } from 'lucide-react';
import { deleteDictionary, getInstalledDictionaries, importYomitanZip, installBundledDictionary } from '../../utils/yomitanDB';
import {
  getPackProgress, installRecommendedPack, isFrequencyDictionary, isPitchDictionary,
  packItems, packStatus, subscribePackProgress, type PackProgress
} from '../../utils/dictionaryPack';
import type { ConfirmOptions } from '../ConfirmModal';

/**
 * Settings › Dictionaries: what is installed (dictionaries, frequency lists, pitch accent), the
 * recommended set at the top, and one "Add" sheet with the bundled catalog and import from file.
 * Styles: "Dictionary settings" in yoru-design-system.css.
 */

type Lang = 'es' | 'en';
type Group = 'terms' | 'frequency' | 'pitch';

interface Props {
  lang: string;
  settings: any;
  onSaveSettings: (settings: any) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const tr = (lang: Lang, es: string, en: string) => (lang === 'es' ? es : en);

interface CatalogItem { asset: string; group: Group; match: (title: string) => boolean; name: [string, string]; desc: [string, string] }

// Everything that ships inside the app (public/dictionaries). [es, en] texts.
const CATALOG: CatalogItem[] = [
  { asset: 'JMdict_spanish.zip', group: 'terms', match: t => /^JMdict \(Spanish\)/i.test(t), name: ['JMdict · Español', 'JMdict · Spanish'], desc: ['Japonés → español', 'Japanese → Spanish'] },
  { asset: 'JMdict_english.zip', group: 'terms', match: t => /^JMdict( \(English\))? \[/i.test(t), name: ['JMdict · Inglés', 'JMdict · English'], desc: ['Japonés → inglés', 'Japanese → English'] },
  { asset: 'frequency-novels.zip', group: 'frequency', match: t => /^Novels/i.test(t), name: ['Novelas', 'Novels'], desc: ['Palabras más usadas en novelas', 'Most used words in novels'] },
  { asset: 'frequency-jiten-anime.zip', group: 'frequency', match: t => /^Jiten \(Anime\)/i.test(t), name: ['Anime', 'Anime'], desc: ['Frecuencia en anime (jiten.moe)', 'Frequency in anime (jiten.moe)'] },
  { asset: 'frequency-netflix.zip', group: 'frequency', match: t => /^Netflix/i.test(t), name: ['Netflix', 'Netflix'], desc: ['Frecuencia en subtítulos de Netflix', 'Frequency in Netflix subtitles'] },
  { asset: 'frequency-visual-novels.zip', group: 'frequency', match: t => /^VN Freq/i.test(t), name: ['Novelas visuales', 'Visual novels'], desc: ['Frecuencia en novelas visuales', 'Frequency in visual novels'] },
  { asset: 'frequency-youtube.zip', group: 'frequency', match: t => /^Youtube/i.test(t), name: ['YouTube', 'YouTube'], desc: ['Frecuencia en vídeos de YouTube', 'Frequency in YouTube videos'] },
  { asset: 'pitch-accent-japanese.zip', group: 'pitch', match: t => /アクセント辞典/.test(t), name: ['Acento tonal japonés', 'Japanese pitch accent'], desc: ['Gráfico de tono en el popup', 'Pitch graph in the popup'] },
];

const groupOf = (dictionary: any): Group => isPitchDictionary(dictionary) ? 'pitch' : isFrequencyDictionary(dictionary) ? 'frequency' : 'terms';

function describe(dictionary: any, lang: Lang): { name: string; desc: string } {
  const known = CATALOG.find(item => item.match(dictionary.title || ''));
  const i = lang === 'es' ? 0 : 1;
  if (known) return { name: known.name[i], desc: known.desc[i] };
  const description = String(dictionary.description || '').trim();
  const imported = dictionary.importedAt
    ? tr(lang, 'Importado el ', 'Imported on ') + new Date(dictionary.importedAt).toLocaleDateString(lang === 'es' ? 'es' : 'en', { day: 'numeric', month: 'short', year: 'numeric' })
    : tr(lang, 'Importado', 'Imported');
  return { name: String(dictionary.title || '').replace(/\s*\[[^\]]*\]$/, ''), desc: description || imported };
}

const sortByOrder = (dictionaries: any[], order: string[]) => {
  if (!order?.length) return dictionaries;
  const rank = (title: string) => { const index = order.indexOf(title); return index === -1 ? order.length : index; };
  return [...dictionaries].sort((a, b) => rank(a.title) - rank(b.title));
};

export default function DictionarySettings({ lang: appLang, settings, onSaveSettings, confirm }: Props) {
  const lang: Lang = appLang === 'es' ? 'es' : 'en';
  const [installed, setInstalled] = useState<any[] | null>(null);
  const [pack, setPack] = useState<PackProgress>(getPackProgress);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [busyAsset, setBusyAsset] = useState<string | null>(null);
  const [task, setTask] = useState<{ label: string; percent: number; error?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setInstalled(await getInstalledDictionaries());
    } catch (error) {
      console.error('Failed to read dictionaries:', error);
      setInstalled([]);
    }
  }, []);

  useEffect(() => {
    void load();
    const onChange = () => { void load(); };
    window.addEventListener('yoru-dictionaries-changed', onChange);
    const unsubscribe = subscribePackProgress(setPack);
    return () => { window.removeEventListener('yoru-dictionaries-changed', onChange); unsubscribe(); };
  }, [load]);

  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuFor]);

  const ready = (installed || []).filter(dictionary => dictionary.importState !== 'installing');
  const ordered = sortByOrder(ready, settings.dictionaryOrder || []);
  const disabled: string[] = settings.disabledDictionaries || [];
  const status = installed ? packStatus(installed) : null;
  const missing = status ? packItems(lang).filter(item => !status[item.id]) : [];

  const toggle = (title: string) => {
    onSaveSettings({
      ...settings,
      disabledDictionaries: disabled.includes(title) ? disabled.filter(t => t !== title) : [...disabled, title]
    });
  };

  const move = (title: string, delta: number) => {
    const group = groupOf(ordered.find(d => d.title === title));
    const inGroup = ordered.filter(d => groupOf(d) === group).map(d => d.title);
    const from = inGroup.indexOf(title);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= inGroup.length) return;
    [inGroup[from], inGroup[to]] = [inGroup[to], inGroup[from]];
    let next = 0;
    const order = ordered.map(d => groupOf(d) === group ? inGroup[next++] : d.title);
    onSaveSettings({ ...settings, dictionaryOrder: order });
  };

  const remove = async (title: string) => {
    const ok = await confirm({
      title: tr(lang, '¿Eliminar diccionario?', 'Delete dictionary?'),
      message: tr(lang, `Se borrará «${title}» de este dispositivo. Puedes volver a añadirlo cuando quieras.`, `"${title}" will be removed from this device. You can add it again any time.`),
      type: 'danger',
      confirmText: tr(lang, 'Eliminar', 'Delete'),
    });
    if (!ok) return;
    setInstalled(current => (current || []).filter(d => d.title !== title));
    try {
      await deleteDictionary(title);
    } finally {
      window.dispatchEvent(new Event('yoru-dictionaries-changed'));
    }
  };

  const addBundled = async (item: CatalogItem) => {
    setBusyAsset(item.asset);
    setTask({ label: item.name[lang === 'es' ? 0 : 1], percent: 0 });
    try {
      await installBundledDictionary(item.asset, lang, (_message, percent) => setTask(current => current && { ...current, percent }));
      setTask(null);
    } catch (error: any) {
      setTask(current => current && { ...current, error: error?.message || String(error) });
    } finally {
      setBusyAsset(null);
      void load();
    }
  };

  const addFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setAddOpen(false);
    setTask({ label: file.name, percent: 0 });
    try {
      await importYomitanZip(file, (_message, percent) => setTask(current => current && { ...current, percent }), lang);
      setTask(null);
      window.dispatchEvent(new Event('yoru-dictionaries-changed'));
    } catch (error: any) {
      setTask(current => current && { ...current, error: error?.message || String(error) });
    } finally {
      void load();
    }
  };

  const renderGroup = (group: Group, title: string, hint?: string) => {
    const list = ordered.filter(d => groupOf(d) === group);
    if (list.length === 0) return null;
    return (
      <div className="dict-settings-group">
        <div className="dict-settings-group-head">
          <span>{title}</span>
          {hint && list.length > 1 && <span>{hint}</span>}
        </div>
        {list.map((dictionary, index) => {
          const { name, desc } = describe(dictionary, lang);
          const on = !disabled.includes(dictionary.title);
          return (
            <div key={dictionary.title} className={`dict-settings-item${on ? '' : ' off'}`}>
              <div className="dict-settings-item-text">
                <div className="dict-settings-item-name" title={dictionary.title}>{name}</div>
                <div className="dict-settings-item-desc">{desc}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={on ? tr(lang, `Desactivar ${name}`, `Turn off ${name}`) : tr(lang, `Activar ${name}`, `Turn on ${name}`)}
                className={`dict-settings-switch${on ? ' on' : ''}`}
                onClick={() => toggle(dictionary.title)}
              />
              <div className="dict-settings-menu-wrap">
                <button
                  type="button"
                  className="dict-settings-icon-btn"
                  aria-label={tr(lang, 'Más opciones', 'More options')}
                  onClick={(event) => { event.stopPropagation(); setMenuFor(current => current === dictionary.title ? null : dictionary.title); }}
                >
                  <MoreVertical size={16} />
                </button>
                {menuFor === dictionary.title && (
                  <div className="dict-settings-menu" role="menu">
                    {index > 0 && (
                      <button type="button" role="menuitem" onClick={() => move(dictionary.title, -1)}><ArrowUp size={14} /> {tr(lang, 'Subir', 'Move up')}</button>
                    )}
                    {index < list.length - 1 && (
                      <button type="button" role="menuitem" onClick={() => move(dictionary.title, 1)}><ArrowDown size={14} /> {tr(lang, 'Bajar', 'Move down')}</button>
                    )}
                    <button type="button" role="menuitem" className="danger" onClick={() => void remove(dictionary.title)}><Trash2 size={14} /> {tr(lang, 'Eliminar', 'Delete')}</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="dict-settings">
      {/* The recommended set */}
      {status && (
        <div className={`dict-settings-pack${missing.length === 0 ? ' ready' : ''}`}>
          <div className="dict-settings-pack-title">
            {missing.length === 0 ? tr(lang, 'Todo listo', 'All set') : tr(lang, 'Recomendado para leer', 'Recommended for reading')}
          </div>
          {missing.length === 0 ? (
            <div className="dict-settings-pack-line"><span className="dict-settings-check"><Check size={11} /></span>{tr(lang, 'Diccionario · Frecuencia · Acento tonal', 'Dictionary · Frequency · Pitch accent')}</div>
          ) : (
            <>
              {packItems(lang).map(item => (
                <div key={item.id} className="dict-settings-pack-line">
                  <span className={`dict-settings-check${status[item.id] ? '' : ' missing'}`}>{status[item.id] ? <Check size={11} /> : null}</span>
                  {item.label}
                </div>
              ))}
              {pack.running ? (
                <div className="dict-settings-progress" aria-live="polite">
                  <div className="dict-settings-progress-label"><span>{tr(lang, `Instalando ${pack.step} de ${pack.total}…`, `Installing ${pack.step} of ${pack.total}…`)}</span><span>{pack.percent}%</span></div>
                  <div className="dict-settings-progress-track"><div style={{ width: `${pack.percent}%` }} /></div>
                </div>
              ) : (
                <button type="button" className="dict-settings-primary" onClick={() => { void installRecommendedPack(lang).catch(() => undefined).finally(load); }}>
                  {tr(lang, 'Instalar lo que falta', 'Install what is missing')} <span>· {tr(lang, 'sin internet', 'offline')}</span>
                </button>
              )}
            </>
          )}
        </div>
      )}

      {task && (
        <div className={`dict-settings-progress standalone${task.error ? ' error' : ''}`} aria-live="polite">
          <div className="dict-settings-progress-label">
            <span>{task.error ? tr(lang, `No se pudo instalar ${task.label}: ${task.error}`, `Could not install ${task.label}: ${task.error}`) : tr(lang, `Instalando ${task.label}…`, `Installing ${task.label}…`)}</span>
            {task.error
              ? <button type="button" className="dict-settings-icon-btn" aria-label={tr(lang, 'Cerrar', 'Close')} onClick={() => setTask(null)}><X size={14} /></button>
              : <span>{task.percent}%</span>}
          </div>
          {!task.error && <div className="dict-settings-progress-track"><div style={{ width: `${task.percent}%` }} /></div>}
        </div>
      )}

      {installed === null ? (
        <div className="dict-settings-empty"><Loader2 size={16} className="guide-spin" /></div>
      ) : ready.length === 0 ? (
        <div className="dict-settings-empty">{tr(lang, 'Aún no hay nada instalado.', 'Nothing installed yet.')}</div>
      ) : (
        <>
          {renderGroup('terms', tr(lang, 'Diccionarios', 'Dictionaries'), tr(lang, 'el primero sale arriba', 'first one shows on top'))}
          {renderGroup('frequency', tr(lang, 'Frecuencia', 'Frequency'), tr(lang, 'el primero da las estrellas', 'first one gives the stars'))}
          {renderGroup('pitch', tr(lang, 'Acento tonal', 'Pitch accent'))}
        </>
      )}

      <button type="button" className="dict-settings-add" onClick={() => setAddOpen(true)}>
        <Plus size={16} /> {tr(lang, 'Añadir diccionario o lista', 'Add a dictionary or list')}
      </button>
      <input ref={fileInputRef} type="file" accept=".zip" onChange={addFile} style={{ display: 'none' }} />

      {addOpen && (
        <div className="dict-settings-sheet-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setAddOpen(false); }}>
          <div className="dict-settings-sheet" role="dialog" aria-modal="true" aria-label={tr(lang, 'Añadir', 'Add')}>
            <div className="dict-settings-sheet-head">
              <span>{tr(lang, 'Añadir', 'Add')}</span>
              <button type="button" className="dict-settings-icon-btn" aria-label={tr(lang, 'Cerrar', 'Close')} onClick={() => setAddOpen(false)}><X size={18} /></button>
            </div>
            <div className="dict-settings-sheet-body">
              {(['terms', 'frequency', 'pitch'] as Group[]).map(group => (
                <div key={group} className="dict-settings-group">
                  <div className="dict-settings-group-head">
                    <span>{group === 'terms' ? tr(lang, 'Diccionarios incluidos', 'Bundled dictionaries') : group === 'frequency' ? tr(lang, 'Listas de frecuencia', 'Frequency lists') : tr(lang, 'Acento tonal', 'Pitch accent')}</span>
                    {group === 'terms' && <span>{tr(lang, 'sin internet', 'offline')}</span>}
                  </div>
                  {CATALOG.filter(item => item.group === group).map(item => {
                    const isInstalled = ready.some(d => item.match(d.title || ''));
                    const isBusy = busyAsset === item.asset;
                    return (
                      <div key={item.asset} className="dict-settings-item">
                        <div className="dict-settings-item-text">
                          <div className="dict-settings-item-name">{item.name[lang === 'es' ? 0 : 1]}</div>
                          <div className="dict-settings-item-desc">{item.desc[lang === 'es' ? 0 : 1]}</div>
                        </div>
                        <button
                          type="button"
                          className={`dict-settings-chip-btn${isInstalled ? ' done' : ''}`}
                          disabled={isInstalled || Boolean(busyAsset) || pack.running}
                          onClick={() => void addBundled(item)}
                        >
                          {isInstalled ? <><Check size={13} /> {tr(lang, 'Instalado', 'Installed')}</> : isBusy ? `${task?.percent ?? 0}%` : tr(lang, 'Añadir', 'Add')}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
              <div className="dict-settings-group">
                <div className="dict-settings-group-head"><span>{tr(lang, 'Otro', 'Other')}</span></div>
                <button type="button" className="dict-settings-item dict-settings-file" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={16} />
                  <div className="dict-settings-item-text">
                    <div className="dict-settings-item-name">{tr(lang, 'Desde un archivo .zip', 'From a .zip file')}</div>
                    <div className="dict-settings-item-desc">{tr(lang, 'Cualquier diccionario o lista de Yomitan', 'Any Yomitan dictionary or list')}</div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
