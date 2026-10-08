import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactElement } from 'react'
import {
  compressPetImage,
  deletePetPhotoBlob,
  getPetPhotoBlob,
  putPetPhotoBlob,
  readPetCare,
  readPetPhotos,
  readPets,
  readPetsSubTab,
  writePetCare,
  writePetPhotos,
  writePets,
  writePetsSubTab,
  type PetsSubTabId,
  type WbPet,
  type WbPetCareItem,
  type WbPetCareKind,
  type WbPetCareStatus,
  type WbPetPhotoMeta,
  type WbPetSpecies,
} from './workbench-pins'
import { WbDeleteBtn, WbRowActions } from './WbRowActions'

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

const SPECIES: { id: WbPetSpecies; labelVi: string; labelEn: string; emoji: string }[] = [
  { id: 'dog', labelVi: 'Chó', labelEn: 'Dog', emoji: '🐕' },
  { id: 'cat', labelVi: 'Mèo', labelEn: 'Cat', emoji: '🐈' },
  { id: 'bird', labelVi: 'Chim', labelEn: 'Bird', emoji: '🐦' },
  { id: 'fish', labelVi: 'Cá', labelEn: 'Fish', emoji: '🐟' },
  { id: 'rabbit', labelVi: 'Thỏ', labelEn: 'Rabbit', emoji: '🐇' },
  { id: 'other', labelVi: 'Khác', labelEn: 'Other', emoji: '🐾' },
]

const SUB_TABS: { id: PetsSubTabId; labelVi: string; labelEn: string }[] = [
  { id: 'roster', labelVi: 'Thú cưng của tôi', labelEn: 'My pets' },
  { id: 'care', labelVi: 'Chăm thú cưng', labelEn: 'Pet care' },
  { id: 'gallery', labelVi: 'Album ảnh', labelEn: 'Photo album' },
]

const CARE_KINDS: { id: WbPetCareKind; labelVi: string; labelEn: string; emoji: string }[] = [
  { id: 'feed', labelVi: 'Cho ăn', labelEn: 'Feed', emoji: '🍽️' },
  { id: 'walk', labelVi: 'Đi dạo', labelEn: 'Walk', emoji: '🦮' },
  { id: 'bath', labelVi: 'Tắm', labelEn: 'Bath', emoji: '🛁' },
  { id: 'groom', labelVi: 'Chải lông / cắt tỉa', labelEn: 'Groom', emoji: '✂️' },
  { id: 'meds', labelVi: 'Thuốc / vitamin', labelEn: 'Meds', emoji: '💊' },
  { id: 'vet', labelVi: 'Khám thú y', labelEn: 'Vet visit', emoji: '🩺' },
  { id: 'play', labelVi: 'Chơi / vận động', labelEn: 'Play', emoji: '🎾' },
  { id: 'other', labelVi: 'Khác', labelEn: 'Other', emoji: '📌' },
]

function careKindMeta(id: WbPetCareKind) {
  return CARE_KINDS.find((k) => k.id === id) ?? CARE_KINDS[CARE_KINDS.length - 1]!
}

function todayLocalDate(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function careSortKey(it: WbPetCareItem): string {
  return `${it.scheduledDate}T${it.scheduledTime || '00:00'}`
}

function speciesMeta(id: WbPetSpecies) {
  return SPECIES.find((s) => s.id === id) ?? SPECIES[SPECIES.length - 1]!
}

export function PetsPane({ vi }: { vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [sub, setSub] = useState<PetsSubTabId>(() => readPetsSubTab())
  const [pets, setPets] = useState<WbPet[]>(() => readPets())
  const [photos, setPhotos] = useState<WbPetPhotoMeta[]>(() => readPetPhotos())
  const [care, setCare] = useState<WbPetCareItem[]>(() => readPetCare())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const persistPets = (next: WbPet[]) => {
    setPets(next)
    writePets(next)
  }
  const persistPhotos = (next: WbPetPhotoMeta[]) => {
    setPhotos(next)
    writePetPhotos(next)
  }
  const persistCare = (next: WbPetCareItem[]) => {
    setCare(next)
    writePetCare(next)
  }

  const selectSub = (id: PetsSubTabId) => {
    setSub(id)
    writePetsSubTab(id)
    setSelectedId(null)
  }

  const selected = pets.find((p) => p.id === selectedId) ?? null

  return (
    <div className="wb-pets">
      <div className="wb-pets-hero">
        <div className="wb-pets-hero-copy">
          <strong>{label('Góc thú cưng', 'Pet corner')}</strong>
          <p>
            {label(
              'Hồ sơ, lịch chăm sóc & album ảnh lưu trên máy này — không tải lên đám mây.',
              'Profiles, care schedule & photo albums stay on this device — nothing is uploaded to the cloud.',
            )}
          </p>
        </div>
        <div className="wb-pets-hero-art" aria-hidden="true">
          <span>🐾</span>
          <span>♡</span>
        </div>
      </div>

      <nav className="wb-subtabs" aria-label={label('Tab con Thú cưng', 'Pets sub-tabs')}>
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`wb-subtab${sub === t.id ? ' active' : ''}`}
            onClick={() => selectSub(t.id)}
          >
            {vi ? t.labelVi : t.labelEn}
          </button>
        ))}
      </nav>

      {err ? <p className="wb-pets-err">{err}</p> : null}

      {sub === 'roster' && !selected && (
        <RosterView
          vi={vi}
          pets={pets}
          photos={photos}
          onSelect={setSelectedId}
          onAdd={(pet) => {
            persistPets([pet, ...pets])
            setSelectedId(pet.id)
          }}
          onDelete={async (id) => {
            const doomed = photos.filter((p) => p.petId === id)
            for (const ph of doomed) {
              try {
                await deletePetPhotoBlob(ph.id)
              } catch {
                /* ignore */
              }
            }
            persistPhotos(photos.filter((p) => p.petId !== id))
            persistCare(care.filter((c) => c.petId !== id))
            persistPets(pets.filter((p) => p.id !== id))
          }}
        />
      )}

      {sub === 'roster' && selected && (
        <PetDetail
          vi={vi}
          pet={selected}
          photos={photos.filter((p) => p.petId === selected.id)}
          onBack={() => setSelectedId(null)}
          onUpdate={(next) => persistPets(pets.map((p) => (p.id === next.id ? next : p)))}
          onPhotosChange={persistPhotos}
          allPhotos={photos}
          onError={setErr}
        />
      )}

      {sub === 'care' && (
        <CareView vi={vi} pets={pets} items={care} onChange={persistCare} />
      )}

      {sub === 'gallery' && (
        <GalleryView
          vi={vi}
          pets={pets}
          photos={photos}
          onOpenPet={(id) => {
            setSub('roster')
            writePetsSubTab('roster')
            setSelectedId(id)
          }}
        />
      )}
    </div>
  )
}

function RosterView({
  vi,
  pets,
  photos,
  onSelect,
  onAdd,
  onDelete,
}: {
  vi: boolean
  pets: WbPet[]
  photos: WbPetPhotoMeta[]
  onSelect: (id: string) => void
  onAdd: (pet: WbPet) => void
  onDelete: (id: string) => void
}): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [name, setName] = useState('')
  const [species, setSpecies] = useState<WbPetSpecies>('dog')
  const [breed, setBreed] = useState('')
  const [birthday, setBirthday] = useState('')
  const [sex, setSex] = useState<WbPet['sex']>('unknown')
  const [color, setColor] = useState('')
  const [notes, setNotes] = useState('')
  const [showForm, setShowForm] = useState(false)

  const add = () => {
    const n = name.trim()
    if (!n) return
    onAdd({
      id: newId(),
      name: n,
      species,
      ...(breed.trim() ? { breed: breed.trim() } : {}),
      ...(birthday ? { birthday } : {}),
      sex: sex || 'unknown',
      ...(color.trim() ? { color: color.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      createdAt: new Date().toISOString(),
    })
    setName('')
    setBreed('')
    setBirthday('')
    setSex('unknown')
    setColor('')
    setNotes('')
    setShowForm(false)
  }

  return (
    <>
      <div className="wb-pets-toolbar">
        <p className="teacher-hint" style={{ margin: 0 }}>
          {label(
            `${pets.length} thú cưng · chạm thẻ để xem hồ sơ & thêm ảnh.`,
            `${pets.length} pets · tap a card for profile & photos.`,
          )}
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm
            ? label('Đóng form', 'Close form')
            : label('+ Thêm thú cưng', '+ Add pet')}
        </button>
      </div>

      {showForm && (
        <div className="wb-module-form wb-pets-form">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={label('Tên thú cưng *', 'Pet name *')}
          />
          <select value={species} onChange={(e) => setSpecies(e.target.value as WbPetSpecies)}>
            {SPECIES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.emoji} {vi ? s.labelVi : s.labelEn}
              </option>
            ))}
          </select>
          <input
            value={breed}
            onChange={(e) => setBreed(e.target.value)}
            placeholder={label('Giống (tuỳ chọn)', 'Breed (optional)')}
          />
          <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
          <select value={sex} onChange={(e) => setSex(e.target.value as WbPet['sex'])}>
            <option value="unknown">{label('Giới tính: chưa rõ', 'Sex: unknown')}</option>
            <option value="male">{label('Đực', 'Male')}</option>
            <option value="female">{label('Cái', 'Female')}</option>
          </select>
          <input
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder={label('Màu lông / vảy', 'Color / coat')}
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={label('Ghi chú chăm sóc…', 'Care notes…')}
            rows={2}
          />
          <button type="button" className="btn btn-primary" onClick={add} disabled={!name.trim()}>
            {label('Lưu thú cưng', 'Save pet')}
          </button>
        </div>
      )}

      {pets.length === 0 ? (
        <div className="wb-pets-empty">
          <span aria-hidden="true">🐾</span>
          <p>
            {label(
              'Chưa có thú cưng. Thêm hồ sơ đầu tiên để bắt đầu album ảnh tại máy.',
              'No pets yet. Add a first profile to start an on-device photo album.',
            )}
          </p>
        </div>
      ) : (
        <div className="wb-pets-grid">
          {pets.map((pet) => (
            <PetCard
              key={pet.id}
              pet={pet}
              photoCount={photos.filter((p) => p.petId === pet.id).length}
              vi={vi}
              onOpen={() => onSelect(pet.id)}
              onDelete={() => {
                if (
                  window.confirm(
                    label(`Xoá ${pet.name} và toàn bộ ảnh?`, `Delete ${pet.name} and all photos?`),
                  )
                ) {
                  onDelete(pet.id)
                }
              }}
            />
          ))}
        </div>
      )}
    </>
  )
}

function PetCard({
  pet,
  photoCount,
  vi,
  onOpen,
  onDelete,
}: {
  pet: WbPet
  photoCount: number
  vi: boolean
  onOpen: () => void
  onDelete: () => void
}): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const meta = speciesMeta(pet.species)
  const [avatar, setAvatar] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!pet.avatarPhotoId) {
      setAvatar(null)
      return
    }
    void getPetPhotoBlob(pet.avatarPhotoId).then((url) => {
      if (!cancelled) setAvatar(url)
    })
    return () => {
      cancelled = true
    }
  }, [pet.avatarPhotoId])

  return (
    <article className="wb-pet-card">
      <button type="button" className="wb-pet-card-main" onClick={onOpen}>
        <div
          className="wb-pet-avatar"
          style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}
        >
          {!avatar ? <span>{meta.emoji}</span> : null}
        </div>
        <div className="wb-pet-card-body">
          <strong>{pet.name}</strong>
          <span>
            {meta.emoji} {vi ? meta.labelVi : meta.labelEn}
            {pet.breed ? ` · ${pet.breed}` : ''}
          </span>
          <small>
            {photoCount} {label('ảnh', 'photos')}
            {pet.birthday ? ` · ${pet.birthday}` : ''}
          </small>
        </div>
      </button>
      <button type="button" className="wb-pet-card-del" onClick={onDelete} aria-label={label('Xoá', 'Delete')}>
        ×
      </button>
    </article>
  )
}

function PetDetail({
  vi,
  pet,
  photos,
  allPhotos,
  onBack,
  onUpdate,
  onPhotosChange,
  onError,
}: {
  vi: boolean
  pet: WbPet
  photos: WbPetPhotoMeta[]
  allPhotos: WbPetPhotoMeta[]
  onBack: () => void
  onUpdate: (pet: WbPet) => void
  onPhotosChange: (items: WbPetPhotoMeta[]) => void
  onError: (msg: string) => void
}): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const meta = speciesMeta(pet.species)
  const uploadRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState(pet.notes ?? '')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const next: Record<string, string> = {}
      for (const ph of photos) {
        const data = await getPetPhotoBlob(ph.id)
        if (data) next[ph.id] = data
      }
      if (!cancelled) setUrls(next)
    })()
    return () => {
      cancelled = true
    }
  }, [photos])

  const addFiles = async (files: FileList | null, source: 'upload' | 'camera') => {
    if (!files?.length) return
    setBusy(true)
    onError('')
    try {
      const added: WbPetPhotoMeta[] = []
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue
        const dataUrl = await compressPetImage(file)
        const id = newId()
        await putPetPhotoBlob(id, dataUrl)
        added.push({
          id,
          petId: pet.id,
          takenAt: new Date().toISOString(),
          source,
        })
      }
      if (added.length === 0) return
      const nextPhotos = [...added, ...allPhotos]
      onPhotosChange(nextPhotos)
      if (!pet.avatarPhotoId) {
        onUpdate({ ...pet, avatarPhotoId: added[0]!.id })
      }
    } catch {
      onError(
        label(
          'Không lưu được ảnh (dung lượng máy / quyền truy cập). Thử ảnh nhỏ hơn.',
          'Could not save photo (device storage / permission). Try a smaller image.',
        ),
      )
    } finally {
      setBusy(false)
    }
  }

  const removePhoto = async (id: string) => {
    try {
      await deletePetPhotoBlob(id)
    } catch {
      /* ignore */
    }
    onPhotosChange(allPhotos.filter((p) => p.id !== id))
    if (pet.avatarPhotoId === id) {
      const fallback = photos.find((p) => p.id !== id)?.id
      onUpdate({ ...pet, ...(fallback ? { avatarPhotoId: fallback } : { avatarPhotoId: undefined }) })
    }
  }

  const onFile = (e: ChangeEvent<HTMLInputElement>, source: 'upload' | 'camera') => {
    const files = e.target.files
    e.target.value = ''
    void addFiles(files, source)
  }

  return (
    <div className="wb-pet-detail">
      <button type="button" className="wb-pets-back" onClick={onBack}>
        ← {label('Danh sách', 'Back to list')}
      </button>

      <header className="wb-pet-detail-head">
        <div
          className="wb-pet-avatar is-lg"
          style={
            pet.avatarPhotoId && urls[pet.avatarPhotoId]
              ? { backgroundImage: `url(${urls[pet.avatarPhotoId]})` }
              : undefined
          }
        >
          {!(pet.avatarPhotoId && urls[pet.avatarPhotoId]) ? <span>{meta.emoji}</span> : null}
        </div>
        <div>
          <h3>{pet.name}</h3>
          <p>
            {meta.emoji} {vi ? meta.labelVi : meta.labelEn}
            {pet.breed ? ` · ${pet.breed}` : ''}
            {pet.color ? ` · ${pet.color}` : ''}
          </p>
          {pet.birthday ? (
            <small>
              {label('Sinh', 'Born')}: {pet.birthday}
            </small>
          ) : null}
        </div>
      </header>

      <div className="wb-pets-photo-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => cameraRef.current?.click()}
        >
          {label('📷 Chụp ảnh', '📷 Take photo')}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => uploadRef.current?.click()}
        >
          {label('📁 Tải ảnh lên', '📁 Upload photos')}
        </button>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => onFile(e, 'camera')}
        />
        <input
          ref={uploadRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => onFile(e, 'upload')}
        />
      </div>
      <p className="teacher-hint">
        {label(
          'Ảnh được nén và lưu trên máy (IndexedDB) — chỉ xem được trên thiết bị này.',
          'Photos are compressed and stored on-device (IndexedDB) — available only on this device.',
        )}
      </p>

      {photos.length === 0 ? (
        <div className="wb-pets-empty is-compact">
          <p>{label('Chưa có ảnh. Chụp hoặc tải lên nhé.', 'No photos yet. Take or upload some.')}</p>
        </div>
      ) : (
        <div className="wb-pets-album">
          {photos.map((ph) => (
            <figure key={ph.id} className="wb-pets-shot">
              {urls[ph.id] ? (
                <img src={urls[ph.id]} alt={ph.caption || pet.name} />
              ) : (
                <div className="wb-pets-shot-ph">{label('Đang tải…', 'Loading…')}</div>
              )}
              <figcaption>
                <span>{ph.source === 'camera' ? label('Camera', 'Camera') : label('Tải lên', 'Upload')}</span>
                <span>{new Date(ph.takenAt).toLocaleDateString()}</span>
              </figcaption>
              <div className="wb-pets-shot-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={pet.avatarPhotoId === ph.id}
                  onClick={() => onUpdate({ ...pet, avatarPhotoId: ph.id })}
                >
                  {pet.avatarPhotoId === ph.id
                    ? label('Ảnh đại diện', 'Avatar')
                    : label('Đặt làm đại diện', 'Set as avatar')}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void removePhoto(ph.id)}
                >
                  {label('Xoá ảnh', 'Delete')}
                </button>
              </div>
            </figure>
          ))}
        </div>
      )}

      <label className="wb-pets-notes">
        <span>{label('Ghi chú chăm sóc', 'Care notes')}</span>
        <textarea
          value={notes}
          rows={3}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            const next = notes.trim()
            if ((pet.notes ?? '') !== next) {
              onUpdate({ ...pet, ...(next ? { notes: next } : { notes: undefined }) })
            }
          }}
          placeholder={label('Thức ăn, thuốc, thói quen…', 'Food, meds, habits…')}
        />
      </label>
    </div>
  )
}

function CareView({
  vi,
  pets,
  items,
  onChange,
}: {
  vi: boolean
  pets: WbPet[]
  items: WbPetCareItem[]
  onChange: (items: WbPetCareItem[]) => void
}): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const [filter, setFilter] = useState<'upcoming' | 'done' | 'all'>('upcoming')
  const [petId, setPetId] = useState(pets[0]?.id ?? '')
  const [kind, setKind] = useState<WbPetCareKind>('feed')
  const [title, setTitle] = useState('')
  const [scheduledDate, setScheduledDate] = useState(todayLocalDate)
  const [scheduledTime, setScheduledTime] = useState('')
  const [note, setNote] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [resultDrafts, setResultDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!petId && pets[0]) setPetId(pets[0].id)
    if (petId && !pets.some((p) => p.id === petId)) {
      setPetId(pets[0]?.id ?? '')
    }
  }, [pets, petId])

  const petMap = useMemo(() => new Map(pets.map((p) => [p.id, p])), [pets])

  const visible = useMemo(() => {
    const list = items.filter((it) => {
      if (filter === 'upcoming') return it.status === 'planned'
      if (filter === 'done') return it.status === 'done' || it.status === 'skipped'
      return true
    })
    return list.sort((a, b) => {
      if (filter === 'done') {
        return (b.completedAt || careSortKey(b)).localeCompare(a.completedAt || careSortKey(a))
      }
      return careSortKey(a).localeCompare(careSortKey(b))
    })
  }, [items, filter])

  const add = () => {
    if (!petId || !scheduledDate) return
    const item: WbPetCareItem = {
      id: newId(),
      petId,
      kind,
      scheduledDate,
      status: 'planned',
      createdAt: new Date().toISOString(),
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(scheduledTime ? { scheduledTime } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    }
    onChange([item, ...items])
    setTitle('')
    setNote('')
    setScheduledTime('')
    setScheduledDate(todayLocalDate())
    setShowForm(false)
  }

  const setStatus = (id: string, status: WbPetCareStatus, result?: string) => {
    onChange(
      items.map((it) => {
        if (it.id !== id) return it
        if (status === 'planned') {
          const { result: _r, completedAt: _c, ...rest } = it
          return { ...rest, status: 'planned' }
        }
        return {
          ...it,
          status,
          completedAt: new Date().toISOString(),
          ...(result?.trim() ? { result: result.trim() } : it.result ? { result: it.result } : {}),
        }
      }),
    )
    setResultDrafts((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  if (pets.length === 0) {
    return (
      <div className="wb-pets-empty">
        <span aria-hidden="true">🗓️</span>
        <p>
          {label(
            'Thêm thú cưng ở tab «Thú cưng của tôi» trước, rồi lập lịch chăm sóc tại đây.',
            'Add a pet in “My pets” first, then schedule care here.',
          )}
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="wb-pets-toolbar">
        <p className="teacher-hint" style={{ margin: 0 }}>
          {label(
            'Lập lịch chăm sóc và cập nhật kết quả — chỉ lưu trên máy này.',
            'Schedule care and log results — stored on this device only.',
          )}
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm
            ? label('Đóng form', 'Close form')
            : label('+ Lịch chăm sóc', '+ Schedule care')}
        </button>
      </div>

      <div className="wb-pets-care-filters" role="group" aria-label={label('Lọc lịch', 'Filter')}>
        {(
          [
            ['upcoming', 'Sắp tới', 'Upcoming'],
            ['done', 'Đã xong', 'Done'],
            ['all', 'Tất cả', 'All'],
          ] as const
        ).map(([id, viL, enL]) => (
          <button
            key={id}
            type="button"
            className={`wb-subtab${filter === id ? ' active' : ''}`}
            onClick={() => setFilter(id)}
          >
            {vi ? viL : enL}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="wb-module-form wb-pets-form">
          <label>
            <span>{label('Thú cưng', 'Pet')}</span>
            <select value={petId} onChange={(e) => setPetId(e.target.value)}>
              {pets.map((p) => (
                <option key={p.id} value={p.id}>
                  {speciesMeta(p.species).emoji} {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{label('Loại chăm sóc', 'Care type')}</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as WbPetCareKind)}>
              {CARE_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.emoji} {vi ? k.labelVi : k.labelEn}
                </option>
              ))}
            </select>
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={label('Tiêu đề (tuỳ chọn)', 'Title (optional)')}
          />
          <label>
            <span>{label('Ngày', 'Date')}</span>
            <input
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
            />
          </label>
          <label>
            <span>{label('Giờ (tuỳ chọn)', 'Time (optional)')}</span>
            <input
              type="time"
              value={scheduledTime}
              onChange={(e) => setScheduledTime(e.target.value)}
            />
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={label('Ghi chú kế hoạch…', 'Plan note…')}
            rows={2}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={add}
            disabled={!petId || !scheduledDate}
          >
            {label('Lưu lịch', 'Save schedule')}
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="wb-pets-empty is-compact">
          <p>
            {filter === 'upcoming'
              ? label('Chưa có lịch sắp tới. Thêm lịch chăm sóc nhé.', 'No upcoming care. Add a schedule.')
              : filter === 'done'
                ? label('Chưa có kết quả chăm sóc.', 'No care results yet.')
                : label('Chưa có mục chăm sóc.', 'No care items yet.')}
          </p>
        </div>
      ) : (
        <ul className="wb-module-list wb-pets-care-list">
          {visible.map((it) => {
            const pet = petMap.get(it.petId)
            const kindMeta = careKindMeta(it.kind)
            const when = [it.scheduledDate, it.scheduledTime].filter(Boolean).join(' · ')
            const statusLabel =
              it.status === 'done'
                ? label('Đã xong', 'Done')
                : it.status === 'skipped'
                  ? label('Bỏ qua', 'Skipped')
                  : label('Chờ làm', 'Planned')
            return (
              <li
                key={it.id}
                className={`wb-module-row wb-pets-care-row${
                  it.status !== 'planned' ? ' is-done' : ''
                }`}
              >
                <div className="wb-module-meta">
                  <strong>
                    {kindMeta.emoji} {it.title?.trim() || (vi ? kindMeta.labelVi : kindMeta.labelEn)}
                    {' · '}
                    {pet ? pet.name : label('Thú cưng', 'Pet')}
                  </strong>
                  <span>
                    {when} · {statusLabel}
                    {it.note ? ` · ${it.note}` : ''}
                  </span>
                  {it.result ? (
                    <span className="wb-pets-care-result">
                      {label('Kết quả', 'Result')}: {it.result}
                    </span>
                  ) : null}
                </div>

                {it.status === 'planned' ? (
                  <div className="wb-pets-care-actions">
                    <textarea
                      className="wb-pets-care-result-input"
                      rows={2}
                      value={resultDrafts[it.id] ?? ''}
                      onChange={(e) =>
                        setResultDrafts((prev) => ({ ...prev, [it.id]: e.target.value }))
                      }
                      placeholder={label(
                        'Cập nhật kết quả (VD: ăn hết khẩu phần, chơi 20 phút…)',
                        'Log result (e.g. finished meal, played 20 min…)',
                      )}
                    />
                    <WbRowActions>
                      <button
                        type="button"
                        className="wb-row-chip"
                        onClick={() => setStatus(it.id, 'done', resultDrafts[it.id])}
                      >
                        {label('Hoàn thành', 'Done')}
                      </button>
                      <button
                        type="button"
                        className="wb-row-chip"
                        onClick={() => setStatus(it.id, 'skipped', resultDrafts[it.id])}
                      >
                        {label('Bỏ qua', 'Skip')}
                      </button>
                      <WbDeleteBtn
                        label={label('Xoá', 'Delete')}
                        onClick={() => onChange(items.filter((x) => x.id !== it.id))}
                      />
                    </WbRowActions>
                  </div>
                ) : (
                  <WbRowActions>
                    <button
                      type="button"
                      className="wb-row-chip"
                      onClick={() => setStatus(it.id, 'planned')}
                    >
                      {label('Mở lại', 'Reopen')}
                    </button>
                    <WbDeleteBtn
                      label={label('Xoá', 'Delete')}
                      onClick={() => onChange(items.filter((x) => x.id !== it.id))}
                    />
                  </WbRowActions>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

function GalleryView({
  vi,
  pets,
  photos,
  onOpenPet,
}: {
  vi: boolean
  pets: WbPet[]
  photos: WbPetPhotoMeta[]
  onOpenPet: (petId: string) => void
}): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const petMap = useMemo(() => new Map(pets.map((p) => [p.id, p])), [pets])
  const [urls, setUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const next: Record<string, string> = {}
      for (const ph of photos.slice(0, 60)) {
        const data = await getPetPhotoBlob(ph.id)
        if (data) next[ph.id] = data
      }
      if (!cancelled) setUrls(next)
    })()
    return () => {
      cancelled = true
    }
  }, [photos])

  if (photos.length === 0) {
    return (
      <div className="wb-pets-empty">
        <span aria-hidden="true">📷</span>
        <p>
          {label(
            'Album trống. Mở hồ sơ thú cưng để chụp hoặc tải ảnh lên.',
            'Album is empty. Open a pet profile to take or upload photos.',
          )}
        </p>
      </div>
    )
  }

  return (
    <div className="wb-pets-gallery">
      {photos.map((ph) => {
        const pet = petMap.get(ph.petId)
        return (
          <button
            key={ph.id}
            type="button"
            className="wb-pets-gallery-tile"
            onClick={() => onOpenPet(ph.petId)}
            title={pet?.name}
          >
            {urls[ph.id] ? (
              <img src={urls[ph.id]} alt={pet?.name || 'pet'} />
            ) : (
              <span className="wb-pets-shot-ph">…</span>
            )}
            <span>{pet?.name ?? label('Thú cưng', 'Pet')}</span>
          </button>
        )
      })}
    </div>
  )
}
