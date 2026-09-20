import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DraftSchedule, LateShiftAnchor, RotationMode, ScheduleRun, ScheduleSummary, api } from '../api'
import { lateShiftAnchorLabels, roleLabels, rotationLabels, scheduleStatusLabels } from '../lib/labels'
import { addDays, formatDate, warsawDate } from '../lib/dates'
import { DraftFocus, DraftScheduleMatrix } from '../components/DraftScheduleMatrix'
import { DraftFairnessPanel } from '../components/DraftFairnessPanel'
import { DraftList } from '../components/DraftList'
import { DraftProblems, draftProblems } from '../components/DraftProblems'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DateField } from '../components/DateField'
import { ScheduleComparison } from '../components/ScheduleComparison'
import {
  Box,
  Button,
  Dialog,
  Disclosure,
  ErrorState,
  Field,
  Input,
  PageHeader,
  SectionHeading,
  Select,
  StatusBadge,
  StatusTone,
  Steps,
  Tag,
  Tooltip,
} from '../ui'

/** CP-SAT statuses that mean the model was actually solved. */
const SOLVER_OK = ['OPTIMAL', 'FEASIBLE']

/** Why „Przekaż do akceptacji" is off: the API would answer 409 anyway. */
const PROPOSE_BLOCKED = 'Najpierw usuń dyżury w dniach zgłoszonej niedostępności'

/** Mirrors `scheduler.GENERATION_BUDGET_PASSES`; only for the live preview
 *  while the coordinator is still typing an unsaved budget. */
const GENERATION_BUDGET_PASSES = 4

/** Polish count of generations ahead in the queue. */
export function jobsAhead(count: number): string {
  if (count === 1) return '1 zadanie przed Tobą'
  const rest = count % 10
  const tens = count % 100
  const few = rest >= 2 && rest <= 4 && (tens < 10 || tens >= 20)
  return `${count} ${few ? 'zadania' : 'zadań'} przed Tobą`
}

/** The sentence under the progress bar while a generation waits its turn. */
function queueSentence(run: ScheduleRun): string {
  if (!run.queue_position) return 'Zadanie oczekuje na wolny proces generatora.'
  const start = run.estimated_start_seconds
  const eta = start && start > 0 ? `, szacowany start za około ${start} s` : ''
  return `W kolejce: ${jobsAhead(run.queue_position)}${eta}.`
}

const STAGES: Array<DraftSchedule['status']> = ['draft', 'proposed', 'published']
const STAGE_ACTORS: Record<DraftSchedule['status'], string> = {
  draft: 'koordynator poprawia',
  proposed: 'koordynator akceptuje',
  published: 'widoczny dla zespołu',
  superseded: 'zastąpiony',
}
const statusTone: Record<DraftSchedule['status'], StatusTone> = { draft: 'draft', proposed: 'prop', published: 'pub', superseded: 'muted' }

export function GeneratorPanel() {
  const queryClient = useQueryClient()
  const today = warsawDate()
  const policy = useQuery({ queryKey: ['scheduling-policy'], queryFn: api.schedulingPolicy })
  const drafts = useQuery({ queryKey: ['draft-schedules'], queryFn: api.draftSchedules })
  const [searchParams, setSearchParams] = useSearchParams()
  const hasLinkedRange = searchParams.has('od') || searchParams.has('do')
  const suggestedRange = useQuery({
    queryKey: ['suggested-schedule-range'],
    queryFn: api.suggestedScheduleRange,
    enabled: !hasLinkedRange,
  })
  // The calendar sends coordinators here with `od`/`do` prefilled when a gap
  // sits outside the published range, so the next step is one click away.
  const [range, setRange] = useState({
    starts_on: searchParams.get('od') ?? today,
    ends_on: searchParams.get('do') ?? addDays(today, 13),
  })
  const [result, setResult] = useState<DraftSchedule | null>(null)
  const [runProgress, setRunProgress] = useState<ScheduleRun | null>(null)
  const [focus, setFocus] = useState<DraftFocus | null>(null)
  useEffect(() => {
    if (suggestedRange.data && !hasLinkedRange) {
      setRange({ starts_on: suggestedRange.data.starts_on, ends_on: suggestedRange.data.ends_on })
    }
  }, [hasLinkedRange, suggestedRange.data])
  const openId = searchParams.get('szkic')
  const setOpenId = (id: string | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (id) next.set('szkic', id)
      else next.delete('szkic')
      return next
    })
  }
  const opened = useQuery({ queryKey: ['schedule', openId], queryFn: () => api.schedule(openId!), enabled: Boolean(openId) })
  useEffect(() => {
    if (opened.data) setResult(opened.data)
  }, [opened.data])
  // Hard unavailability the draft was generated before, or that arrived after.
  // The backend rejects propose and publish over it, so the screen must neither
  // claim the draft satisfies every hard rule nor offer the button (HGH5-02).
  const conflictCount = result?.unavailability_conflicts?.length ?? 0
  const conflictPeople = new Set((result?.unavailability_conflicts ?? []).map((item) => item.assignee_name)).size
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false)
  const [changeResolutions, setChangeResolutions] = useState<Record<string, 'draft' | 'change'>>({})
  const publishPreview = useQuery({
    queryKey: ['publish-preview', result?.id, result?.version],
    queryFn: () => api.publishPreview(result!.id),
    enabled: publishConfirmOpen && result?.status === 'proposed',
  })
  useEffect(() => setChangeResolutions({}), [result?.id, result?.version])
  const [toDelete, setToDelete] = useState<ScheduleSummary | null>(null)
  const invalidateDrafts = () => {
    queryClient.invalidateQueries({ queryKey: ['active-runs'] })
    queryClient.invalidateQueries({ queryKey: ['draft-schedules'] })
    // Without this the ['schedule', id] entry keeps the pre-transition payload
    // for the global 30s staleTime and the effect above would rewind `result`.
    queryClient.invalidateQueries({ queryKey: ['schedule'] })
  }
  const remove = useMutation({
    mutationFn: api.deleteSchedule,
    onSuccess: (_data, id) => {
      setToDelete(null)
      if (openId === id) {
        setOpenId(null)
        setResult(null)
      }
      invalidateDrafts()
    },
  })
  // Rotation mode and the 11–19 anchor are stored policy, not request
  // parameters; they are written only on an explicit save, never on change.
  const [settings, setSettings] = useState({
    rotation_mode: 'hybrid' as RotationMode,
    late_shift_anchor: 'secondary' as LateShiftAnchor,
    fairness_weight: 3,
    continuity_weight: 1,
    preference_weight: 2,
    solve_seconds: 15,
  })
  useEffect(() => {
    if (policy.data) {
      setSettings({
        rotation_mode: policy.data.rotation_mode,
        late_shift_anchor: policy.data.late_shift_anchor,
        fairness_weight: policy.data.fairness_weight,
        continuity_weight: policy.data.continuity_weight,
        preference_weight: policy.data.preference_weight,
        solve_seconds: policy.data.solve_seconds,
      })
    }
  }, [policy.data])
  const savePolicy = useMutation({
    mutationFn: api.updateSchedulingPolicy,
    onSuccess: (value) => queryClient.setQueryData(['scheduling-policy'], value),
  })
  const settingsDirty = Boolean(policy.data && (
    settings.rotation_mode !== policy.data.rotation_mode
    || settings.late_shift_anchor !== policy.data.late_shift_anchor
    || settings.fairness_weight !== policy.data.fairness_weight
    || settings.continuity_weight !== policy.data.continuity_weight
    || settings.preference_weight !== policy.data.preference_weight
    || settings.solve_seconds !== policy.data.solve_seconds
  ))
  const onGenerated = (value: DraftSchedule) => {
    setRunProgress(null)
    setResult(value)
    setOpenId(value.id)
    invalidateDrafts()
  }
  const generate = useMutation({
    mutationFn: (input: { starts_on: string; ends_on: string }) => api.generateSchedule(input, setRunProgress),
    onSuccess: onGenerated,
  })
  // A generation outlives the page that started it. Without rejoining it the
  // screen shows nothing while the worker is busy, and the natural reaction is
  // to press the button again (MED5-11, LOW5-09).
  const resume = useMutation({
    mutationFn: (runId: string) => api.followRun(runId, setRunProgress),
    onSuccess: onGenerated,
  })
  const activeRuns = useQuery({ queryKey: ['active-runs'], queryFn: api.activeRuns })
  const generating = generate.isPending || resume.isPending
  useEffect(() => {
    const running = activeRuns.data?.[0]
    if (!running || generating || resume.isSuccess || resume.isError) return
    setRunProgress(running)
    resume.mutate(running.id)
    // `resume` is a stable mutation object; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRuns.data, generating])
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!generating || !runProgress?.created_at) {
      setElapsed(0)
      return
    }
    const began = Date.parse(runProgress.created_at)
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - began) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [generating, runProgress?.created_at])
  const settle = (value: DraftSchedule) => {
    setResult(value)
    invalidateDrafts()
  }
  const propose = useMutation({ mutationFn: api.proposeSchedule, onSuccess: settle })
  const withdraw = useMutation({ mutationFn: api.withdrawSchedule, onSuccess: settle })
  const publish = useMutation({
    mutationFn: api.publishSchedule,
    onSuccess: (value) => {
      settle(value)
      setPublishConfirmOpen(false)
      queryClient.invalidateQueries({ queryKey: ['published-schedule'] })
      queryClient.invalidateQueries({ queryKey: ['calendar'] })
    },
  })
  const error = policy.error ?? savePolicy.error ?? generate.error ?? resume.error ?? propose.error ?? withdraw.error ?? publish.error ?? remove.error
  const problemCount = result ? draftProblems(result).length : 0
  const numberField = (key: 'fairness_weight' | 'preference_weight' | 'continuity_weight' | 'solve_seconds', label: string, hint: string, min: number, max: number, step: number) => (
    <Field label={label} id={`policy-${key}`} hint={hint}>
      {({ id, describedBy }) => (
        <Input
          id={id}
          name={key}
          type="number"
          mono
          min={min}
          max={max}
          step={step}
          value={settings[key]}
          aria-describedby={describedBy}
          onChange={(event) => setSettings({ ...settings, [key]: Number(event.target.value) })}
        />
      )}
    </Field>
  )

  return (
    <div className="page">
      <PageHeader
        title="Generator"
        sub="Wynik jest szkicem. Nie zastępuje opublikowanego grafiku, dopóki go nie opublikujesz."
      />
      {error && (
        <Box tone="bad" role="alert" title={error.message}>
          {(generate.error || resume.error) && runProgress?.conflicts && runProgress.conflicts.length > 0 && (
            <ul className="box-list">{runProgress.conflicts.map((conflict) => <li key={conflict}>{conflict}</li>)}</ul>
          )}
        </Box>
      )}
      <section className="stack-sm">
        <SectionHeading title="Nowy szkic" meta="maks. 35 dni na jedno generowanie" />
        <form className="panel panel-padded stack-sm" onSubmit={(event) => { event.preventDefault(); generate.mutate(range) }} aria-label="Nowy szkic">
          <div className="frow">
            <DateField id="generator-from" label="Od" value={range.starts_on} onChange={(value) => setRange({ ...range, starts_on: value })} required />
            <DateField id="generator-to" label="Do" value={range.ends_on} onChange={(value) => setRange({ ...range, ends_on: value })} required />
            <div style={{ alignSelf: 'end' }}>
              <Button type="submit" variant="primary" icon="wand" disabled={generating} loading={generating}>
                {generating ? (runProgress?.status === 'queued' ? 'W kolejce…' : 'Generuję…') : 'Utwórz szkic'}
              </Button>
            </div>
          </div>
          <div className="small muted">
            Zapisane ustawienia: {rotationLabels[policy.data?.rotation_mode ?? 'hybrid']} · 11–19: {lateShiftAnchorLabels[policy.data?.late_shift_anchor ?? 'secondary']}
            {settingsDirty && <b> · masz niezapisane zmiany w ustawieniach</b>}
            . Dłuższy okres podziel na kolejne, zachodzące po sobie szkice.
          </div>
          {range.starts_on === range.ends_on && range.starts_on !== '' && (
            <Box tone="warn" title="Zakres obejmuje jeden dzień.">
              Bilansowanie na jednym dniu nie ma sensu: solver tylko obsadzi ten dzień, nie wyrówna niczyjego udziału.
            </Box>
          )}
          {generating && (
            <div className="stack-sm" aria-live="polite">
              {Boolean(runProgress?.uncovered_before?.length) && (
                <Box tone="warn">
                  Przed początkiem szkicu pozostaje {runProgress!.uncovered_before!.length} nieobsadzonych dni: {runProgress!.uncovered_before!.map(formatDate).join(', ')}.
                </Box>
              )}
              <div className="progress" role="progressbar" aria-valuenow={runProgress?.progress ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label="Postęp generowania">
                <i style={{ width: `${runProgress?.progress ?? 0}%` }} />
              </div>
              <div className="small muted">
                {runProgress?.status === 'queued' ? queueSentence(runProgress) : 'Solver pracuje poza procesem API. Możesz korzystać z pozostałych ekranów.'}
              </div>
              {/* The budget is per solver pass, and a hard model is solved several
                  times over, so the counter can pass the budget without a defect.
                  Outside the live region: it changes every second. */}
              {runProgress?.solve_seconds !== undefined && (
                <div className="small muted mono" aria-live="off">
                  {elapsed} s · budżet {Math.round(runProgress.solve_seconds)} s na jeden przebieg solvera, trudny grafik wymaga kilku
                  {policy.data?.time_budget_seconds !== undefined && `, łącznie do ${Math.round(policy.data.time_budget_seconds)} s`}.
                </div>
              )}
              {resume.isPending && <div className="small muted">Wznowiono podgląd generowania rozpoczętego wcześniej - nie uruchamiaj go drugi raz.</div>}
            </div>
          )}
        </form>
        <Disclosure title="Ustawienia generowania" meta={settingsDirty ? 'niezapisane zmiany' : undefined}>
          <form className="stack-sm" onSubmit={(event) => { event.preventDefault(); savePolicy.mutate(settings) }} aria-label="Ustawienia generowania">
            <Box tone="muted">
              Ustawienia są zapisywane globalnie dla całego zespołu i obowiązują od następnego generowania. Wagi zmieniają względny priorytet reguł miękkich; nie mogą wyłączyć eligibility, niedostępności ani wymaganego pokrycia. Znaczenie ma wyłącznie relacja między wagami: 6 / 4 / 2 działa tak samo jak 3 / 2 / 1. Wartość 0 wyłącza wskazany człon celu w całości.
            </Box>
            <div className="frow">
              <Field label="Tryb rotacji" id="policy-rotation-mode" hint="Bazowy blok rotacji. Każda doba i tak pozostaje osobnym przydziałem.">
                {({ id, describedBy }) => (
                  <Select id={id} name="rotation_mode" value={settings.rotation_mode} disabled={policy.isLoading} aria-describedby={describedBy} onChange={(event) => setSettings({ ...settings, rotation_mode: event.target.value as RotationMode })}>
                    {Object.entries(rotationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Powiązanie 11–19" id="policy-late-shift-anchor" hint="Reguła twarda dla osób eligible do obu ról; pozostałe wyjątki są raportowane.">
                {({ id, describedBy }) => (
                  <Select id={id} name="late_shift_anchor" value={settings.late_shift_anchor} disabled={policy.isLoading} aria-describedby={describedBy} onChange={(event) => setSettings({ ...settings, late_shift_anchor: event.target.value as LateShiftAnchor })}>
                    {Object.entries(lateShiftAnchorLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </Select>
                )}
              </Field>
            </div>
            {settings.rotation_mode === 'weekly' && (
              <Box tone="warn" title="Tryb tygodniowy wyłącza limit 3 dyżurów w 7 dniach i dwudniowy odpoczynek po serii.">
                Inaczej tydzień u jednej osoby byłby nie do obsadzenia. Zmierzone skutki: serie 12-dniowe i 31 okien z ponad 3 dyżurami.
              </Box>
            )}
            <div className="frow">
              {numberField('fairness_weight', 'Równy udział', 'Najwyższy domyślny priorytet: wyrównuje cały rozkład i mocniej karze wartości odstające. Podniesienie odbierze dyżur osobie, która ma ich najwięcej, nawet jeśli wolałaby go wziąć.', 0, 100, 0.5)}
              {numberField('preference_weight', 'Preferencje zespołu', 'Środkowy priorytet: respektuje „wolę nie” i „chętnie wezmę”. Podniesienie częściej obsadzi weekend osobą, która się o niego zgłosiła, kosztem równego udziału.', 0, 100, 0.5)}
              {numberField('continuity_weight', 'Ciągłość rotacji', 'Najniższy priorytet: ogranicza przekazania w obrębie tygodnia. Podniesienie wydłuży serie u jednej osoby zamiast rozdzielać tydzień.', 0, 100, 0.5)}
              {numberField('solve_seconds', 'Budżet czasu na przebieg solvera (s)', `Jedno generowanie wykonuje kilka przebiegów, więc górny limit całego generowania to około ${Math.round((settings.solve_seconds || 0) * GENERATION_BUDGET_PASSES)} s. Dłuższy budżet nie poprawia rozpiętości powyżej wartości domyślnej - podnoś go dla dłuższych zakresów.`, 5, 300, 5)}
            </div>
            <Box tone="muted">
              Weekendy i bloki świąteczne są regułą twardą: solver zawsze przydziela cały blok jednej osobie w danej roli. Podział bloku jest możliwy tylko ręcznie, przez korektę koordynatora albo zamianę po publikacji.
            </Box>
            <div className="row">
              <Button type="submit" variant={settingsDirty ? 'primary' : 'default'} disabled={savePolicy.isPending || policy.isLoading || !settingsDirty} loading={savePolicy.isPending}>
                {savePolicy.isPending ? 'Zapisuję…' : 'Zapisz ustawienia generowania'}
              </Button>
              {savePolicy.isSuccess && !settingsDirty && <span className="small muted">Zapisano.</span>}
            </div>
          </form>
        </Disclosure>
      </section>
      <section className="stack-sm">
        <SectionHeading title="Szkice" meta={drafts.data ? `${drafts.data.length}` : undefined} />
        <DraftList activeId={result?.id} onOpen={setOpenId} onDelete={setToDelete} deleting={remove.isPending} />
        {(drafts.data?.some((item) => item.rotation_mode === 'daily') && drafts.data.some((item) => item.rotation_mode === 'weekly')) && (
          <Disclosure title="Porównaj wariant dzienny i tygodniowy">
            <ScheduleComparison drafts={drafts.data ?? []} />
          </Disclosure>
        )}
      </section>
      {opened.isLoading && <p className="muted">Otwieranie szkicu…</p>}
      {opened.error && <ErrorState error={opened.error} onRetry={() => opened.refetch()} />}
      <ConfirmDialog
        open={Boolean(toDelete)}
        pending={remove.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        title="Usunąć szkic?"
        confirmLabel="Usuń"
        confirmColor="error"
        description={toDelete && <>{toDelete.name} ({formatDate(toDelete.starts_on)} - {formatDate(toDelete.ends_on)}). Tej operacji nie da się cofnąć.</>}
      />
      {result && (
        <section className="stack" aria-label={result.name}>
          <SectionHeading
            title={result.name}
            meta={`${formatDate(result.starts_on)} – ${formatDate(result.ends_on)} · v${result.version}`}
            controls={(
              <>
                <StatusBadge tone={statusTone[result.status]}>{scheduleStatusLabels[result.status]}</StatusBadge>
                <Tag>{rotationLabels[result.rotation_mode]}</Tag>
                <Tag tone={result.solver_status === 'OPTIMAL' ? 'sig' : SOLVER_OK.includes(result.solver_status) ? undefined : 'bad'}>CP-SAT: {result.solver_status}</Tag>
                <Tag>{result.assignments.length} przydziałów</Tag>
              </>
            )}
          />
          <Steps
            label="Etap szkicu"
            steps={STAGES.map((stage) => ({
              label: <><b>{scheduleStatusLabels[stage]}</b> <small>{STAGE_ACTORS[stage]}</small></>,
              state: STAGES.indexOf(stage) < STAGES.indexOf(result.status) ? 'done' : stage === result.status ? 'on' : 'todo',
            }))}
          />
          {result.solver_status === 'FEASIBLE' && conflictCount === 0 && (
            <Box tone="muted">
              Sprawiedliwość: {result.fairness_proven ? 'optymalna (udowodniona)' : 'najlepsza znaleziona'}. Jakość całego rozwiązania: {result.continuity_gap == null
                ? 'bez oszacowania luki'
                : `luka ${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 }).format(result.continuity_gap * 100)}%`}. Stan kryterium pokazuje panel poniżej.
            </Box>
          )}
          {conflictCount > 0 && (
            <Box tone="bad" role="alert" title={`${conflictPeople === 1 ? '1 osoba ma dyżur' : `${conflictPeople} osób ma dyżur`} w dniu zgłoszonej niedostępności.`}>
              {result.status === 'draft'
                ? 'Popraw te komórki w macierzy poniżej albo wygeneruj szkic ponownie; tabela problemów prowadzi do każdej z nich.'
                : 'Szkic nie jest już edytowalny; wygeneruj go ponownie.'}
            </Box>
          )}
          {!SOLVER_OK.includes(result.solver_status) && (
            <Box tone="warn" title={`Solver nie znalazł pełnego rozwiązania (status ${result.solver_status}).`}>
              Najczęstsze przyczyny to zbyt mało osób z eligibility na daną rolę, nakładające się niedostępności albo zbyt krótki zakres. Sprawdź luki w macierzy i popraw je ręcznie albo zawęź zakres.
            </Box>
          )}
          <SectionHeading as="h3" title="Macierz szkicu" meta="kliknij komórkę, aby skorygować przydział" />
          <DraftScheduleMatrix result={result} onChange={setResult} focus={focus} />
          <SectionHeading as="h3" title="Problemy" meta={problemCount > 0 ? `${problemCount}` : 'brak'} />
          <DraftProblems result={result} onFocus={setFocus} editable={result.status === 'draft'} />
          <SectionHeading as="h3" title="Wpływ szkicu na sprawiedliwość" meta="saldo przed zakresem → po tej wersji" />
          <DraftFairnessPanel result={result} />
          <div className="actionbar panel">
            {result.status === 'draft' && conflictCount > 0 && <span className="small" style={{ color: 'var(--bad)' }}>{PROPOSE_BLOCKED}</span>}
            {result.status === 'published' && <StatusBadge tone="pub">grafik opublikowany</StatusBadge>}
            <span className="sp" />
            {result.status === 'draft' && (
              <Tooltip text={conflictCount > 0 ? PROPOSE_BLOCKED : 'Szkic trafi do akceptacji; nadal można go cofnąć'}>
                <Button
                  variant="primary"
                  disabled={propose.isPending || conflictCount > 0}
                  loading={propose.isPending}
                  onClick={() => propose.mutate({ id: result.id, expectedVersion: result.version })}
                >
                  Przekaż do akceptacji
                </Button>
              </Tooltip>
            )}
            {result.status === 'proposed' && (
              <>
                <Button disabled={withdraw.isPending} loading={withdraw.isPending} onClick={() => withdraw.mutate({ id: result.id, expectedVersion: result.version })}>Wróć do szkicu</Button>
                <Button variant="primary" icon="send" disabled={publish.isPending} onClick={() => setPublishConfirmOpen(true)}>Opublikuj grafik…</Button>
              </>
            )}
          </div>
          <Dialog
            open={publishConfirmOpen}
            onOpenChange={setPublishConfirmOpen}
            dismissible={!publish.isPending}
            size="lg"
            title="Opublikować grafik?"
            description={`Dni ${formatDate(result.starts_on)} - ${formatDate(result.ends_on)} będą rozstrzygane z tego grafiku (${new Set(result.assignments.map((item) => item.service_date)).size} dni). Wcześniejszy grafik zachowuje ważność poza tym zakresem; grafiki w całości pokryte nowym zakresem zostaną wycofane.`}
            actions={(
              <>
                <Button onClick={() => setPublishConfirmOpen(false)} disabled={publish.isPending}>Anuluj</Button>
                <Button
                  variant="primary"
                  loading={publish.isPending}
                  disabled={publish.isPending || publishPreview.isLoading || publishPreview.isError
                    || Boolean(publishPreview.data?.lost_changes.some((item) => !changeResolutions[`${item.service_date}:${item.role}`]))}
                  onClick={() => publish.mutate({
                    id: result.id,
                    expectedVersion: result.version,
                    acknowledgeLostChanges: Boolean(publishPreview.data?.lost_changes.length),
                    acknowledgeGap: Boolean(publishPreview.data?.uncovered_before.length),
                    acknowledgeRestViolations: Boolean(publishPreview.data?.rest_violations.length),
                    changeResolutions,
                  })}
                >
                  {publish.isPending ? 'Publikuję…' : 'Tak, opublikuj'}
                </Button>
              </>
            )}
          >
            {result.starts_on <= today && (
              <Box tone="warn" title="Ten zakres obejmuje dzisiejszy albo wcześniejszy dzień.">Publikacja może natychmiast zmienić dyżur, który już trwa.</Box>
            )}
            {publishPreview.isLoading && <p className="muted">Sprawdzam zmiany i oczekujące zamiany…</p>}
            {publishPreview.error && <Box tone="bad" role="alert" title="Nie udało się sprawdzić skutków publikacji. Zamknij okno i spróbuj ponownie." />}
            {publishPreview.data?.lost_changes.length ? (
              <Box tone="warn" title="Rozstrzygnij konflikty ze zmianami">
                <div className="stack-sm" style={{ marginTop: 6 }}>
                  {publishPreview.data.lost_changes.map((change) => (
                    <div key={`${change.service_date}-${change.role}`} className="stack-sm">
                      <div>
                        <span className="mono">{formatDate(change.service_date)}</span> · {roleLabels[change.role]}: zmiana {change.previous_assignee_name}, szkic {change.new_assignee_name}. {change.reason}
                      </div>
                      <Field label="Decyzja" id={`resolution-${change.service_date}-${change.role}`}>
                        {({ id }) => (
                          <Select
                            id={id}
                            value={changeResolutions[`${change.service_date}:${change.role}`] ?? ''}
                            onChange={(event) => setChangeResolutions((current) => ({ ...current, [`${change.service_date}:${change.role}`]: event.target.value as 'draft' | 'change' }))}
                          >
                            <option value="">Wybierz</option>
                            <option value="draft">Zachowaj przydział ze szkicu</option>
                            <option value="change">Zachowaj wcześniejszą zmianę</option>
                          </Select>
                        )}
                      </Field>
                    </div>
                  ))}
                </div>
              </Box>
            ) : null}
            {publishPreview.data?.carried_changes.length ? (
              <Box tone="ok" title="Zmiany zostaną przeniesione">
                <ul className="box-list">
                  {publishPreview.data.carried_changes.map((change) => (
                    <li key={`${change.service_date}-${change.role}`}>{formatDate(change.service_date)} · {roleLabels[change.role]}: {change.previous_assignee_name}</li>
                  ))}
                </ul>
              </Box>
            ) : null}
            {publishPreview.data?.pending_swaps.length ? (
              <Box tone="sig" title="Te oczekujące zamiany zostaną anulowane">
                <ul className="box-list">
                  {publishPreview.data.pending_swaps.map((swap) => (
                    <li key={swap.id}>{formatDate(swap.service_date)} · {roleLabels[swap.role]}: {swap.requester_name} → {swap.replacement_name}</li>
                  ))}
                </ul>
              </Box>
            ) : null}
            {publishPreview.data?.uncovered_before.length ? (
              <Box tone="warn" title="Przed grafikiem pozostanie luka">Nieobsadzone dni: {publishPreview.data.uncovered_before.map(formatDate).join(', ')}.</Box>
            ) : null}
            {publishPreview.data?.stale_changes_count ? (
              <Box tone="warn" title={`Szkic nieaktualny: od wygenerowania zmieniło się ${publishPreview.data.stale_changes_count} wpisów.`} />
            ) : null}
            {publishPreview.data?.rest_violations.length ? (
              <Box tone="bad" title="Publikacja naruszy reguły odpoczynku">
                <ul className="box-list">
                  {publishPreview.data.rest_violations.map((violation) => (
                    <li key={`${violation.member_name}-${violation.rule}`}>{violation.member_name}: {violation.message} {violation.days.map(formatDate).join(', ')}</li>
                  ))}
                </ul>
              </Box>
            ) : null}
          </Dialog>
        </section>
      )}
    </div>
  )
}
