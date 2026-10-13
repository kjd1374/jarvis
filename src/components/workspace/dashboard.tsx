import Link from "next/link";
import { Icon, type IconName } from "./icon";
import { navigation } from "./navigation";
import styles from "./workspace.module.css";

const stats: {
  label: string;
  caption: string;
  icon: IconName;
  href: string;
  color: string;
}[] = [
  {
    label: "진행 중인 작업",
    caption: "한 번에 하나씩, 차근차근",
    icon: "clock",
    href: "/tasks",
    color: "green",
  },
  {
    label: "전체 프로젝트",
    caption: "시작하고 싶은 일을 모아보세요",
    icon: "folder",
    href: "/projects",
    color: "purple",
  },
  {
    label: "보관한 노트",
    caption: "작은 아이디어도 놓치지 않게",
    icon: "note",
    href: "/notes",
    color: "orange",
  },
  {
    label: "완료한 작업",
    caption: "오늘의 작은 성취를 기록하세요",
    icon: "check",
    href: "/tasks",
    color: "blue",
  },
];

export function Dashboard() {
  return (
    <>
      <div className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>OVERVIEW</p>
          <h1>대시보드</h1>
          <p className={styles.pageDescription}>
            해야 할 일부터 떠오른 아이디어까지, 한곳에서 시작하세요.
          </p>
        </div>
        <Link href="/tasks" className={styles.primaryButton}>
          <Icon name="plus" size={18} />
          작업 공간 열기
        </Link>
      </div>
      <section className={styles.hero} aria-labelledby="welcome-title">
        <div className={styles.heroContent}>
          <span className={styles.heroLabel}>
            <span />A LITTLE SPACE FOR BIG IDEAS
          </span>
          <h2 id="welcome-title">
            생각은 가볍게,
            <br />
            하루는 선명하게.
          </h2>
          <p>
            복잡한 일상에 나만의 흐름을 만들어보세요.
            <br />
            Jarvis와 함께, 작은 시작부터.
          </p>
          <Link href="/projects">
            나의 첫 프로젝트 둘러보기 <Icon name="arrow" size={17} />
          </Link>
        </div>
        <div className={styles.orbitArt} aria-hidden="true">
          <span className={styles.orbitOne} />
          <span className={styles.orbitTwo} />
          <span className={styles.orbitThree} />
          <span className={styles.orbitCore}>
            <Icon name="spark" size={54} />
          </span>
          <span className={styles.orbitDotOne} />
          <span className={styles.orbitDotTwo} />
          <span className={styles.orbitTag}>
            <Icon name="check" size={15} />
            one step at a time
          </span>
          <span className={styles.orbitStar}>
            <Icon name="asterisk" size={25} />
          </span>
        </div>
        <span className={styles.heroIndex}>01 — YOUR SPACE, YOUR PACE</span>
      </section>
      <section className={styles.stats} aria-label="워크스페이스 요약">
        {stats.map((stat) => (
          <Link href={stat.href} className={styles.statCard} key={stat.label}>
            <div className={styles.statTop}>
              <span>{stat.label}</span>
              <span className={`${styles.statIcon} ${styles[stat.color]}`}>
                <Icon name={stat.icon} size={18} />
              </span>
            </div>
            <strong>
              0<span>{stat.icon === "folder" ? "개" : "건"}</span>
            </strong>
            <p>{stat.caption}</p>
          </Link>
        ))}
      </section>
      <section className={styles.spacesSection} aria-labelledby="spaces-title">
        <div className={styles.sectionHeading}>
          <h2 id="spaces-title">내 작업 공간</h2>
          <span>필요한 곳에서 시작하세요</span>
        </div>
        <div className={styles.spaceCards}>
          {navigation
            .filter((item) =>
              ["/tasks", "/projects", "/notes"].includes(item.href),
            )
            .map((item, index) => (
              <Link
                key={item.href}
                href={item.href}
                className={styles.spaceCard}
              >
                <div className={styles.spaceCardTop}>
                  <span className={`${styles.spaceIcon} ${styles[item.color]}`}>
                    <Icon name={item.icon} size={23} />
                  </span>
                  <span className={styles.spaceNumber}>0{index + 1}</span>
                </div>
                <h3>{item.label === "작업" ? "작업 관리" : item.label}</h3>
                <p>{item.description}</p>
                <div className={styles.spaceCardBottom}>
                  <span>공간 둘러보기</span>
                  <span className={styles.arrowCircle}>
                    <Icon name="arrow" size={17} />
                  </span>
                </div>
              </Link>
            ))}
        </div>
      </section>
      <div className={styles.bottomGrid}>
        <section
          className={styles.activityCard}
          aria-labelledby="activity-title"
        >
          <div className={styles.sectionHeading}>
            <h2 id="activity-title">최근 활동</h2>
            <span className={styles.subtleBadge}>모든 공간</span>
          </div>
          <div className={styles.emptyActivity}>
            <span className={styles.emptyIcon}>
              <Icon name="clock" size={25} />
            </span>
            <h3>새로운 이야기를 기다리고 있어요</h3>
            <p>이곳에 작업과 프로젝트의 활동이 차곡차곡 쌓일 거예요.</p>
            <Link href="/tasks">
              작업 공간 둘러보기 <Icon name="arrow" size={15} />
            </Link>
          </div>
        </section>
        <section className={styles.tipCard} aria-labelledby="tip-title">
          <span className={styles.tipEyebrow}>
            <Icon name="spark" size={16} />
            MAKE ROOM FOR IDEAS
          </span>
          <h2 id="tip-title">
            좋은 아이디어는
            <br />
            작은 메모에서 시작돼요.
          </h2>
          <p>
            떠오른 생각을 위한 자리를 만들어두세요.
            <br />
            내일의 멋진 시작이 될지도 몰라요.
          </p>
          <Link href="/notes">
            노트 공간 열기 <Icon name="arrow" size={17} />
          </Link>
          <span className={styles.tipDecoration} aria-hidden="true">
            <Icon name="asterisk" size={164} style={{ strokeWidth: 3 }} />
          </span>
        </section>
      </div>
    </>
  );
}
