import styles from "./studio.module.css";

/** Keep long saved text available without letting it determine the page height. */
export function BriefText({ text, label = "전체 내용", limit = 120 }: { text: string; label?: string; limit?: number }) {
  const preview = text.replace(/\s+/g, " ").trim();
  if (preview.length <= limit && text.split("\n").length <= 3) return <p className={styles.agentText}>{text}</p>;
  return <details className={styles.briefText}>
    <summary>
      <span className={styles.briefPreview}>{preview.slice(0, limit)}{preview.length > limit ? "…" : ""}</span>
      <span className={styles.briefMore}>{label} 보기</span>
      <span className={styles.briefLess}>{label} 접기</span>
    </summary>
    <p className={styles.agentText} tabIndex={0}>{text}</p>
  </details>;
}
