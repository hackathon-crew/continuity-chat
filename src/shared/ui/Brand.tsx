import octoMark from '../../vendor/inkpaw/octo-mark.png'

export function BrandName() {
  return (
    <strong className="xb-brand" aria-label="Unigate Chat">
      <span aria-hidden="true">Unigate</span>
      <span className="xb-brand__chat" aria-hidden="true">
        chat
      </span>
    </strong>
  )
}

export function OctoMark({ size = 20 }: { size?: number }) {
  return (
    <img
      className="xb-octo-mark"
      src={octoMark}
      alt=""
      width={size}
      height={Math.round((size * 42) / 48)}
      aria-hidden="true"
    />
  )
}
