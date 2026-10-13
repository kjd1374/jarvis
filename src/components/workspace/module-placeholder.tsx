import Link from "next/link";
import { Icon } from "./icon";
import { navigation } from "./navigation";
import styles from "./workspace.module.css";

export function ModulePlaceholder({
  href,
  eyebrow,
  title,
  description,
  emptyTitle,
  emptyDescription,
}: {
  href: string;
  eyebrow: string;
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const item = navigation.find((entry) => entry.href === href)!;
  return (
    <>
      <div className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1>{title}</h1>
          <p className={styles.pageDescription}>{description}</p>
        </div>
        <span className={styles.subtleBadge}>기능 준비 중</span>
      </div>
      <section className={styles.modulePanel}>
        <div className={styles.moduleToolbar}>
          <span>
            <Icon name={item.icon} size={18} />
            {title} 공간
          </span>
          <span>0개</span>
        </div>
        <div className={styles.moduleEmpty}>
          <div className={`${styles.moduleIllustration} ${styles[item.color]}`}>
            <Icon name={item.icon} size={42} />
          </div>
          <span className={styles.moduleEyebrow}>A FRESH START</span>
          <h2>{emptyTitle}</h2>
          <p>{emptyDescription}</p>
          <span className={styles.moduleNotice}>
            지금은 레이아웃을 둘러볼 수 있어요.
            <br />이 공간에 필요한 기능을 곧 더할 예정입니다.
          </span>
          <Link href="/" className={styles.secondaryButton}>
            <Icon name="grid" size={17} />
            대시보드로 돌아가기
          </Link>
        </div>
      </section>
      <div className={styles.moduleLinks}>
        {navigation
          .filter((entry) => entry.href !== href && entry.href !== "/")
          .map((entry) => (
            <Link href={entry.href} key={entry.href}>
              <Icon name={entry.icon} size={18} />
              <span>{entry.label} 둘러보기</span>
              <Icon name="arrow" size={16} />
            </Link>
          ))}
      </div>
    </>
  );
}
