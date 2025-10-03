import type { ParagraphViewModel } from "../analysis/viewModels/mapParagraphToVM";
import type { SentenceViewModel } from "../analysis/viewModels/mapSentenceToVM";
import './css/Info.css';

interface InfoProps<T> {
    info: T;
}

export const SentenceCardComponent = ({ info }: InfoProps<SentenceViewModel>) => {
  const { id, text, paraphrase, roleLabel, structureLabel, mood } = info;

  const copy = async (label: "text" | "paraphrase" | "id") => {
    const map: Record<string, string | undefined> = { text, paraphrase, id };
    try {
      const value = map[label] ?? "";
      if (value) await navigator.clipboard.writeText(value);
    } catch {
        // 忽略错误
    }
  };

  return (
    <div role="dialog" aria-label="Sentence info card" className="card">
      <div className="caret" />

      <div className="headerRow">
        <span className="badge role"><span className="dot" />{roleLabel ?? "role: —"}</span>
        <span className="badge structure"><span className="dot" />{structureLabel ?? "structure: —"}</span>
        {mood && <span className="badge mood"><span className="dot" />{mood}</span>}
        <div className="idMono">{id}</div>
      </div>

      <div className="content">
        <div className="textBlock">{text}</div>

        {paraphrase ? (
          <div className="paraphraseBlock">
            <div className="sectionLabel">Paraphrase</div>
            {paraphrase}

            {/* ⬇️ 按钮移到 paraphraseBlock 内部 */}
            <div className="footerRow footerRow--inBlock">
              <button onClick={() => copy("text")} className="ghostBtn">Copy text</button>
              <button onClick={() => copy("paraphrase")} className="ghostBtn">Copy paraphrase</button>
              <button onClick={() => copy("id")} className="ghostBtn">Copy id</button>
              <div className="hint"><kbd>Esc</kbd> to dismiss</div>
            </div>
          </div>
        ) : null}
      </div>

      {/* 没有 paraphrase 时，按钮才渲染在卡片底部 */}
      {!paraphrase && (
        <div className="footerRow">
          <button onClick={() => copy("text")} className="ghostBtn">Copy text</button>
          <button onClick={() => copy("id")} className="ghostBtn">Copy id</button>
          <div className="hint"><kbd>Esc</kbd> to dismiss</div>
        </div>
      )}
    </div>
  );
};

export const ParagraphCardComponent = (props: InfoProps<ParagraphViewModel>) => {

  console.log('ParagraphCardComponent props:', props);  
}