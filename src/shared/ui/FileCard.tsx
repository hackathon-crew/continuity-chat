import { DownloadSimpleIcon, FileTextIcon, PresentationChartIcon } from '@phosphor-icons/react'

export function FileCard({ name, meta, fileId }: { name: string; meta: string; fileId: string }) {
  const Icon = name.endsWith('.pptx') ? PresentationChartIcon : FileTextIcon
  return (
    <div className="xb-file">
      <Icon className="xb-file__icon" aria-hidden="true" />
      <span className="xb-file__text">
        <strong>{name}</strong>
        <span className="qx-meta">{meta}</span>
      </span>
      <a
        className="qx-btn qx-btn--ghost qx-btn--icon"
        href={`/api/agent/files/${fileId}`}
        download={name}
        aria-label={`下载 ${name}`}
      >
        <DownloadSimpleIcon />
      </a>
    </div>
  )
}
