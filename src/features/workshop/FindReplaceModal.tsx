import { useState, useMemo } from 'react';
import { Replace, X, CaseSensitive, WholeWord, Search, Check, Loader2 } from 'lucide-react';
import type { WorkbenchSegment } from '../../core/workflow/models';

interface FindReplaceModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly segments: readonly WorkbenchSegment[];
  readonly onReplace: (segmentId: string, newText: string) => Promise<void>;
  readonly onRefresh: () => Promise<void>;
}

interface MatchItem {
  readonly segment: WorkbenchSegment;
  readonly currentText: string;
  readonly previewText: string;
  readonly matchCount: number;
}

export const FindReplaceModal = ({
  isOpen,
  onClose,
  segments,
  onReplace,
  onRefresh,
}: FindReplaceModalProps) => {
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const matches = useMemo<MatchItem[]>(() => {
    if (!findText.trim()) return [];

    const flags = caseSensitive ? 'g' : 'gi';
    const escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = wholeWord ? `\\b${escaped}\\b` : escaped;

    try {
      const regex = new RegExp(pattern, flags);
      const items: MatchItem[] = [];

      for (const segment of segments) {
        const text = segment.selectedTranslation ?? segment.originalTranslation ?? '';
        if (!text) continue;

        const count = (text.match(regex) || []).length;
        if (count > 0) {
          const preview = text.replace(regex, replaceText);
          items.push({
            segment,
            currentText: text,
            previewText: preview,
            matchCount: count,
          });
        }
      }

      return items;
    } catch {
      return [];
    }
  }, [caseSensitive, findText, replaceText, segments, wholeWord]);

  const totalMatches = useMemo(() => {
    return matches.reduce((sum, item) => sum + item.matchCount, 0);
  }, [matches]);

  if (!isOpen) return null;

  const handleReplaceAll = async () => {
    if (matches.length === 0 || replacing) return;
    setReplacing(true);
    setResultMessage(null);

    try {
      for (const item of matches) {
        await onReplace(item.segment.segmentId, item.previewText);
      }
      await onRefresh();
      setResultMessage(`成功替换 ${matches.length} 个段落中的 ${totalMatches} 处文本。`);
    } catch (err) {
      setResultMessage(err instanceof Error ? err.message : '替换过程出现异常。');
    } finally {
      setReplacing(false);
    }
  };

  return (
    <div className="confirm-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="find-replace-modal"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="find-replace-head">
          <div className="head-title">
            <Replace size={20} className="head-icon" />
            <div>
              <h2>查找与替换</h2>
              <p>在当前章节正文译文中查找并批量替换词句</p>
            </div>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <div className="find-replace-body">
          <div className="input-group">
            <label>
              <span>查找文本</span>
              <div className="input-field">
                <Search size={15} />
                <input
                  value={findText}
                  onChange={(e) => {
                    setFindText(e.target.value);
                    setResultMessage(null);
                  }}
                  placeholder="输入要查找的词句…"
                  autoFocus
                />
              </div>
            </label>

            <label>
              <span>替换为</span>
              <div className="input-field">
                <Replace size={15} />
                <input
                  value={replaceText}
                  onChange={(e) => {
                    setReplaceText(e.target.value);
                    setResultMessage(null);
                  }}
                  placeholder="输入替换后的词句…"
                />
              </div>
            </label>
          </div>

          <div className="options-row">
            <button
              type="button"
              className={`opt-btn ${caseSensitive ? 'active' : ''}`}
              onClick={() => setCaseSensitive(!caseSensitive)}
            >
              <CaseSensitive size={15} /> 区分大小写
            </button>
            <button
              type="button"
              className={`opt-btn ${wholeWord ? 'active' : ''}`}
              onClick={() => setWholeWord(!wholeWord)}
            >
              <WholeWord size={15} /> 全词匹配
            </button>
            <span className="match-stat">
              {findText ? `找到 ${matches.length} 个段落（共 ${totalMatches} 处匹配）` : '请输入查找词'}
            </span>
          </div>

          {resultMessage && (
            <p className={`result-msg ${resultMessage.includes('成功') ? 'success' : 'error'}`}>
              <Check size={14} /> {resultMessage}
            </p>
          )}

          <div className="preview-list">
            {matches.length === 0 ? (
              <div className="empty-preview">
                <Search size={28} />
                <p>{findText ? '未在当前段落中找到匹配文本' : '在此处预览匹配段落与替换效果'}</p>
              </div>
            ) : (
              matches.map((item) => (
                <div key={item.segment.segmentId} className="preview-item">
                  <header>
                    <b>段落 #{item.segment.segmentOrdinal}</b>
                    <span>{item.matchCount} 处匹配</span>
                  </header>
                  <p className="before">
                    <small>替换前：</small>
                    {item.currentText}
                  </p>
                  <p className="after">
                    <small>替换后：</small>
                    {item.previewText}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        <footer className="find-replace-foot">
          <button type="button" className="cancel-btn" onClick={onClose} disabled={replacing}>
            关闭
          </button>
          <button
            type="button"
            className="confirm-btn"
            disabled={matches.length === 0 || replacing}
            onClick={() => void handleReplaceAll()}
          >
            {replacing ? (
              <>
                <Loader2 size={15} className="spin" /> 正在批量替换…
              </>
            ) : (
              <>
                <Replace size={15} /> 批量替换全部 ({totalMatches} 处)
              </>
            )}
          </button>
        </footer>
      </section>
    </div>
  );
};
