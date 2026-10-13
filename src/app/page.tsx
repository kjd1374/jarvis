import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <span className={styles.label}>JARVIS</span>
      <h1>새로운 시작을 위한 공간.</h1>
      <p>아이디어를 하나씩 현실로 만들어 갑니다.</p>
    </main>
  );
}
