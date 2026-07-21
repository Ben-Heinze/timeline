import React, { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import type { PhoneStartResult } from '../../shared/types'

interface Props {
  onClose: () => void
}

export default function ImportFromPhoneModal({ onClose }: Props) {
  const [info, setInfo] = useState<PhoneStartResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedIp, setSelectedIp] = useState('')
  const [qr, setQr] = useState('')
  const [status, setStatus] = useState<string>('Waiting for a phone to connect…')

  // Start the server on open, stop it on close. StrictMode double-invoke is safe:
  // startPhoneServer tears down any prior session and rotates the token.
  useEffect(() => {
    let cancelled = false
    window.api.phone.start()
      .then(r => {
        if (cancelled) return
        setInfo(r)
        setSelectedIp(r.lanIps[0] ?? '')
      })
      .catch(e => { if (!cancelled) setError((e as Error).message ?? String(e)) })
    return () => { cancelled = true; window.api.phone.stop() }
  }, [])

  // Live upload status from the receiver.
  useEffect(() => {
    const offProgress = window.api.phone.onUploadProgress(e => setStatus(`Receiving ${e.file}…`))
    const offDone = window.api.phone.onUploadDone(e =>
      setStatus(`Received ${e.received} item${e.received === 1 ? '' : 's'} — check the timeline.`))
    return () => { offProgress(); offDone() }
  }, [])

  const uploadUrl = info && selectedIp
    ? `http://${selectedIp}:${info.port}/?token=${info.token}`
    : ''

  useEffect(() => {
    if (!uploadUrl) { setQr(''); return }
    QRCode.toDataURL(uploadUrl, { width: 240, margin: 1 }).then(setQr).catch(() => setQr(''))
  }, [uploadUrl])

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  }
  const modal: React.CSSProperties = {
    background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.24)', padding: '28px 28px 24px',
    width: 420, maxWidth: '90vw', display: 'flex', flexDirection: 'column', gap: 18,
  }

  const noLan = info && info.lanIps.length === 0

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={modal}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
            Import from phone
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            Scan the code with your phone's camera. Both devices must be on the same Wi-Fi.
          </div>
        </div>

        {error && (
          <div style={{ fontSize: 13, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '10px 12px' }}>
            Couldn't start the upload server: {error}
          </div>
        )}

        {noLan && (
          <div style={{ fontSize: 13, color: 'var(--text-2)', background: 'var(--bg-subtle)', border: '1px solid #d97706', borderRadius: 6, padding: '10px 12px' }}>
            No Wi-Fi / local network connection detected. Connect this computer to the same
            Wi-Fi as your phone, then reopen this window.
          </div>
        )}

        {!info && !error && (
          <div style={{ fontSize: 13, color: 'var(--text-3)', textAlign: 'center', padding: '30px 0' }}>
            Starting…
          </div>
        )}

        {info && !noLan && (
          <>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              {qr
                ? <img src={qr} alt="Upload QR code" width={240} height={240} style={{ borderRadius: 8, background: '#fff', padding: 8 }} />
                : <div style={{ width: 240, height: 240 }} />}
            </div>

            {info.lanIps.length > 1 && (
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                <div style={{ marginBottom: 4 }}>If scanning doesn't connect, try another address:</div>
                <select
                  value={selectedIp}
                  onChange={e => setSelectedIp(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text)' }}
                >
                  {info.lanIps.map(ip => <option key={ip} value={ip}>{ip}</option>)}
                </select>
              </div>
            )}

            <div style={{ fontSize: 12, color: 'var(--text-3)', wordBreak: 'break-all', textAlign: 'center' }}>
              or open <span style={{ userSelect: 'all', fontFamily: 'monospace', color: 'var(--text-2)' }}>{uploadUrl}</span>
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-2)', textAlign: 'center', fontWeight: 600 }}>
              {status}
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '7px 20px', fontSize: 13, fontWeight: 600,
              background: 'var(--accent)', border: 'none', borderRadius: 6,
              cursor: 'pointer', color: 'var(--accent-fg)',
            }}
          >Done</button>
        </div>
      </div>
    </div>
  )
}
