"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icon";
import { navigation } from "./navigation";
import styles from "./workspace.module.css";

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const current =
    navigation.find((item) => item.href === pathname) ?? navigation[0];
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [dialogMode, setDialogMode] = useState<"search" | "help">("search");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const menuRef = useRef<HTMLDialogElement>(null);

  function openDialog(mode: typeof dialogMode) {
    setDialogMode(mode);
    setQuery("");
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setDialogMode("search");
        setQuery("");
        dialogRef.current?.showModal();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const filtered = navigation.filter((item) =>
    `${item.label} ${item.description}`.includes(query.trim()),
  );
  const sidebarContent = (
    <>
      <Link
        href="/"
        className={styles.brand}
        onClick={() => menuRef.current?.close()}
        aria-label="Jarvis 대시보드"
      >
        <span className={styles.brandMark}>
          <Icon name="spark" size={25} />
        </span>
        <span>
          jarvis<span className={styles.brandDot}>.</span>
        </span>
      </Link>
      <div className={styles.workspaceLabel}>
        <span className={styles.workspaceDot} />
        나의 워크스페이스<span className={styles.personal}>개인</span>
      </div>
      <p className={styles.navCaption}>WORKSPACE</p>
      <nav className={styles.navigation} aria-label="주 메뉴">
        {navigation
          .filter((item) => item.href !== "/settings")
          .map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => menuRef.current?.close()}
              aria-current={pathname === item.href ? "page" : undefined}
              className={`${styles.navItem} ${pathname === item.href ? styles.navActive : ""}`}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {pathname === item.href && <span className={styles.activeDot} />}
            </Link>
          ))}
      </nav>
      <div className={styles.sidebarBottom}>
        <div className={styles.sidebarNote}>
          <span className={styles.smallSpark}>
            <Icon name="spark" size={18} />
          </span>
          <p>더 가벼운 하루의 시작</p>
          <span>생각과 할 일에 자리를 만들어주세요.</span>
          <button onClick={() => openDialog("help")}>
            Jarvis 둘러보기 <Icon name="arrow" size={15} />
          </button>
        </div>
        <Link
          href="/settings"
          onClick={() => menuRef.current?.close()}
          className={`${styles.navItem} ${pathname === "/settings" ? styles.navActive : ""}`}
          aria-current={pathname === "/settings" ? "page" : undefined}
        >
          <Icon name="settings" />
          <span>설정</span>
        </Link>
        <div className={styles.profile}>
          <span className={styles.avatar}>J</span>
          <div>
            <strong>내 워크스페이스</strong>
            <span>Personal space</span>
          </div>
          <span className={styles.profileDot} />
        </div>
      </div>
    </>
  );

  return (
    <div className={styles.shell}>
      <a href="#main-content" className={styles.skipLink}>
        본문으로 건너뛰기
      </a>
      <aside className={styles.sidebar}>{sidebarContent}</aside>
      <dialog
        ref={menuRef}
        className={styles.mobileMenu}
        onClose={() => setMenuOpen(false)}
        aria-label="모바일 메뉴"
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <div className={styles.mobileSidebar}>
          <button
            className={styles.closeMenu}
            aria-label="메뉴 닫기"
            onClick={() => menuRef.current?.close()}
          >
            <Icon name="close" />
          </button>
          {sidebarContent}
        </div>
      </dialog>
      <div className={styles.mainColumn}>
        <header className={styles.header}>
          <div className={styles.breadcrumb}>
            <button
              className={styles.menuToggle}
              aria-label="메뉴 열기"
              aria-expanded={menuOpen}
              onClick={() => {
                setMenuOpen(true);
                menuRef.current?.showModal();
              }}
            >
              <Icon name="menu" />
            </button>
            <span className={styles.breadcrumbRoot}>워크스페이스</span>
            <Icon name="chevron" size={13} />
            <span>{current.label}</span>
          </div>
          <div className={styles.headerActions}>
            <button
              className={styles.searchButton}
              onClick={() => openDialog("search")}
              aria-label="작업 공간 검색"
            >
              <Icon name="search" size={17} />
              <span>작업 공간 검색</span>
              <kbd>⌘ K</kbd>
            </button>
            <span className={styles.previewBadge}>레이아웃 미리보기</span>
            <button
              className={styles.helpButton}
              aria-label="사용 안내"
              onClick={() => openDialog("help")}
            >
              <Icon name="help" />
            </button>
          </div>
        </header>
        <main id="main-content" className={styles.main} tabIndex={-1}>
          {children}
        </main>
        <footer className={styles.footer}>
          <span>작은 시작이 모여, 더 나은 하루로.</span>
          <span>
            JARVIS WORKSPACE <span>↗</span>
          </span>
        </footer>
      </div>
      <dialog
        ref={dialogRef}
        className={styles.commandDialog}
        aria-labelledby="dialog-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
      >
        <div className={styles.dialogHeader}>
          <h2 id="dialog-title">
            {dialogMode === "help"
              ? "Jarvis에 오신 것을 환영해요"
              : "작업 공간 검색"}
          </h2>
          <button aria-label="창 닫기" onClick={closeDialog}>
            <Icon name="close" />
          </button>
        </div>
        {dialogMode === "help" ? (
          <div className={styles.helpContent}>
            <div className={styles.helpIllustration}>
              <Icon name="spark" size={36} />
            </div>
            <h3>당신의 하루를 담을 공간</h3>
            <p>
              왼쪽 메뉴에서 작업, 프로젝트, 노트 공간을 둘러보세요. 현재는 기본
              레이아웃을 미리 볼 수 있으며, 각 공간에 필요한 기능을 차례로 더할
              예정입니다.
            </p>
            <button className={styles.primaryButton} onClick={closeDialog}>
              둘러보기 시작 <Icon name="arrow" size={17} />
            </button>
          </div>
        ) : (
          <>
            <label className={styles.dialogSearch}>
              <Icon name="search" />
              <input
                aria-label="공간 이름 검색"
                placeholder="어떤 공간을 찾으세요?"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoFocus
              />
            </label>
            <div className={styles.dialogResults}>
              {filtered.length ? (
                filtered.map((item) => (
                  <Link
                    href={item.href}
                    key={item.href}
                    onClick={closeDialog}
                    className={styles.dialogResult}
                  >
                    <span
                      className={`${styles.spaceIcon} ${styles[item.color]}`}
                    >
                      <Icon name={item.icon} />
                    </span>
                    <div>
                      <strong>{item.label}</strong>
                      <span>{item.description}</span>
                    </div>
                    <Icon name="arrow" size={18} />
                  </Link>
                ))
              ) : (
                <p className={styles.noResults}>
                  일치하는 공간이 없습니다. 다른 이름으로 검색해보세요.
                </p>
              )}
            </div>
            <div className={styles.dialogFooter}>
              이동할 공간을 선택하세요.<kbd>ESC 닫기</kbd>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
