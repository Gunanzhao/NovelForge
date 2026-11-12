import {
  ArrowRight,
  BookOpen,
  Feather,
  FileDown,
  FolderOpen,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAppStore } from '../../stores/app-store'
import { Disclosure } from '../Disclosure'
import { DraftSnapshotRecovery } from '../DraftSnapshotRecovery'
import { ProjectBackup } from '../ProjectBackup'
import { ProjectRescue } from '../ProjectRescue'
import { Button, IconButton } from '../ui'

export type ProjectDialogMode = 'new' | 'open' | 'import'

export function Welcome({
  onProject,
}: {
  onProject: (mode: ProjectDialogMode) => void
}) {
  const recentProjects = useAppStore((state) => state.recentProjects)
  const openProject = useAppStore((state) => state.openProject)
  const setError = useAppStore((state) => state.setError)
  const [query, setQuery] = useState('')
  const projects = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return recentProjects.filter((project) =>
      `${project.title} ${project.path}`.toLocaleLowerCase().includes(term),
    )
  }, [query, recentProjects])

  return (
    <main className="welcome studio-welcome">
      <header className="welcome-masthead">
        <a
          className="studio-wordmark"
          href="#"
          aria-label="NovelForge 首页"
          onClick={(event) => event.preventDefault()}
        >
          <span className="brand-mark">
            <Feather size={20} strokeWidth={1.5} />
          </span>
          NovelForge
          <span className="wordmark-divider" />
          写作工作室
        </a>
        <span className="local-badge">
          <span />
          本地存储 · 自由创作
        </span>
      </header>
      <div className="welcome-layout">
        <section className="welcome-story" aria-labelledby="welcome-title">
          <span className="studio-kicker">A SPACE FOR YOUR STORIES</span>
          <h1 id="welcome-title">
            让故事，
            <br />
            从这里生长。
          </h1>
          <p className="welcome-lead">
            一处安静的写作空间。
            <br />
            从第一行灵感，到最后一章定稿。
          </p>
          <div className="welcome-actions">
            <Button onClick={() => onProject('new')}>
              <Plus size={17} />
              新建小说
              <ArrowRight size={16} />
            </Button>
            <Button variant="outline" onClick={() => onProject('open')}>
              <FolderOpen size={17} />
              打开项目
            </Button>
          </div>
          <button
            className="welcome-import"
            onClick={() => onProject('import')}
          >
            <FileDown size={15} />
            从已有稿件开始
            <ArrowRight size={14} />
          </button>
          <div className="welcome-book" aria-hidden="true">
            <div className="book-spine" />
            <div className="book-page">
              <span>N / F</span>
              <div className="book-title">
                每个故事
                <br />
                都有自己的世界
              </div>
              <div className="book-rule" />
              <small>写下你心中的那一个。</small>
              <Feather size={58} strokeWidth={0.7} />
            </div>
            <span className="book-caption">YOUR NEXT CHAPTER STARTS HERE</span>
          </div>
        </section>
        <section className="welcome-library" aria-labelledby="library-title">
          <div className="library-heading">
            <div>
              <span className="studio-kicker">YOUR LIBRARY</span>
              <h2 id="library-title">回到你的故事</h2>
            </div>
            <span className="library-count">
              {recentProjects.length} 部作品
            </span>
          </div>
          {recentProjects.length > 0 && (
            <div className="library-search">
              <Search size={16} />
              <input
                aria-label="查找最近项目"
                placeholder="查找作品名称或文件夹…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <IconButton
                  icon={X}
                  label="清除项目搜索"
                  onClick={() => setQuery('')}
                />
              )}
            </div>
          )}
          <div className="recent-projects">
            {projects.map((project, index) => (
              <button
                className="recent-project"
                key={project.path}
                onClick={() => void openProject(project.path).catch(setError)}
              >
                <span className="project-cover" aria-hidden="true">
                  <BookOpen size={23} strokeWidth={1.25} />
                  <small>{String(index + 1).padStart(2, '0')}</small>
                </span>
                <span className="recent-project-details">
                  <strong>{project.title}</strong>
                  <small title={project.path}>{project.path}</small>
                  <span className="recent-project-action">
                    继续创作
                    <ArrowRight size={13} />
                  </span>
                </span>
                <ArrowRight size={18} className="project-arrow" />
              </button>
            ))}
          </div>
          {!projects.length && (
            <div className="library-empty">
              <BookOpen size={36} strokeWidth={1} />
              <h3>{query ? '没有找到这部作品' : '下一部作品，属于你'}</h3>
              <p>
                {query
                  ? '试试其他名称，或清除搜索查看全部作品。'
                  : '新建一部小说，或打开已有项目。你的故事会出现在这里。'}
              </p>
              {query && (
                <Button variant="outline" onClick={() => setQuery('')}>
                  查看全部作品
                </Button>
              )}
            </div>
          )}
          <div className="welcome-utilities">
            <Disclosure title="备份与恢复" className="welcome-recovery">
              <ProjectBackup restoreOnly />
              <DraftSnapshotRecovery />
              <ProjectRescue />
            </Disclosure>
            <Disclosure title="了解数据存储" className="welcome-storage">
              <p>
                正文保存在普通 Markdown
                文件中，项目资料保存在本地。新建项目会创建 project.json 和
                .novelforge 数据目录；备份时请保留整个项目文件夹。
              </p>
            </Disclosure>
          </div>
        </section>
      </div>
      <footer className="welcome-footer">
        <span>把世界留给想象，把此刻留给写作。</span>
        <span>NovelForge · 本地优先</span>
      </footer>
    </main>
  )
}
