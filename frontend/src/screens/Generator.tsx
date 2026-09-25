import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DraftSchedule, LateShiftAnchor, RotationMode, ScheduleRun, ScheduleSummary, SchedulingPolicy, api } from '../api'
import { locale, messages, useMessages } from '../i18n'
import { lateShiftAnchorLabels, roleLabels, rotationLabels, scheduleStatusLabels } from '../lib/labels'
import { formatPoints } from '../lib/numbers'
import { addDays, formatDate, formatDayShort, formatRange, isIsoDate, warsawDate } from '../lib/dates'
import { DraftFocus, DraftScheduleMatrix } from '../components/DraftScheduleMatrix'
import { DraftFairnessPanel, worstSpread } from '../components/DraftFairnessPanel'
import { DraftList } from '../components/DraftList'
import { DraftProblems, ProblemGrouping, problemCounts } from '../components/DraftProblems'
import { LegendPopover } from '../components/MatrixControls'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DateField } from '../components/DateField'
import { ScheduleComparison } from '../components/ScheduleComparison'
import {
  Box,
  Button,
  Checkbox,
  Chip,
  ChipRow,
  Dialog,
  Disclosure,
  ErrorState,
  Field,
  Input,
  KeyValue,
  PageHeader,
  Panel,
  SectionHeading,
  Segmented,
  Select,
  StatusBadge,
  StatusTone,
  Steps,
  Tag,
  Tooltip,
  cx,
} from '../ui'

/** CP-SAT statuses that mean the model was actually solved. */
const SOLVER_OK = ['OPTIMAL', 'FEASIBLE']

/** Mirrors `scheduler.GENERATION_BUDGET_PASSES`; only for the live preview
 *  while the coordinator is still typing an unsaved budget. */
const GENERATION_BUDGET_PASSES = 4

/** Count of generations ahead in the queue, in the current language. */
export function jobsAhead(count: number): string {
  return messages().generator.jobsAhead(count)
}

/** The sentence under the progress bar while a generation waits its turn. */
function queueSentence(run: ScheduleRun): string {
  const t = messages().generator.queue
  if (!run.queue_position) return t.waitingForWorker
  const start = run.estimated_start_seconds
  return start && start > 0 ? t.positionWithEta(jobsAhead(run.queue_position), start) : t.position(jobsAhead(run.queue_position))
}

const STAGES: Array<DraftSchedule['status']> = ['draft', 'proposed', 'published']
const statusTone: Record<DraftSchedule['status'], StatusTone> = { draft: 'draft', proposed: 'prop', published: 'pub', superseded: 'muted' }

type Settings = {
  rotation_mode: RotationMode
  late_shift_anchor: LateShiftAnchor
  fairness_weight: number
  continuity_weight: number
  preference_weight: number
  solve_seconds: number
  coordinator_swap_approval_required: boolean
}

const SETTINGS_KEYS = [
  'rotation_mode',
  'late_shift_anchor',
  'fairness_weight',
  'continuity_weight',
  'preference_weight',
  'solve_seconds',
  'coordinator_swap_approval_required',
] as const satisfies readonly (keyof Settings)[]

const settingsOf = (policy: SchedulingPolicy): Settings => ({
  rotation_mode: policy.rotation_mode,
  late_shift_anchor: policy.late_shift_anchor,
  fairness_weight: policy.fairness_weight,
  continuity_weight: policy.continuity_weight,
  preference_weight: policy.preference_weight,
  solve_seconds: policy.solve_seconds,
  coordinator_swap_approval_required: policy.coordinator_swap_approval_required,
})

/**
 * The generator. Without an open draft it is the range form and the list
 * of drafts; with one it is the proposal page: the range as the title, the
 * risk row, the staffing matrix and the problems table on the left, the
 * balance after publication and the settings on the right. The settings
 * live in a drawer, the publication in a sheet that lists its consequences.
 */
export function GeneratorPanel() {
  const { generator: t, common, nav } = useMessages()
  const queryClient = useQueryClient()
  const today = warsawDate()
  const policy = useQuery({ queryKey: ['scheduling-policy'], queryFn: api.schedulingPolicy })
  const drafts = useQuery({ queryKey: ['draft-schedules'], queryFn: api.draftSchedules })
  const [searchParams, setSearchParams] = useSearchParams()
  const linkedStart = searchParams.get('od')
  const linkedEnd = searchParams.get('do')
  const hasLinkedRange = isIsoDate(linkedStart) || isIsoDate(linkedEnd)
  const suggestedRange = useQuery({
    queryKey: ['suggested-schedule-range'],
    queryFn: api.suggestedScheduleRange,
    enabled: !hasLinkedRange,
  })
  // The calendar sends coordinators here with `od`/`do` prefilled when a gap
  // sits outside the published range, so the next step is one click away.
  const [range, setRange] = useState({
    starts_on: isIsoDate(linkedStart) ? linkedStart : today,
    ends_on: isIsoDate(linkedEnd) ? linkedEnd : addDays(today, 13),
  })
  const [result, setResult] = useState<DraftSchedule | null>(null)
  const [runProgress, setRunProgress] = useState<ScheduleRun | null>(null)
  const [focus, setFocus] = useState<DraftFocus | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [problemsBy, setProblemsBy] = useState<ProblemGrouping>('person')
  const [hardOnly, setHardOnly] = useState(false)
  const problemsRef = useRef<HTMLDivElement>(null)
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
  useEffect(() => {
    if (!openId) setResult(null)
  }, [openId])
  // Hard unavailability the draft was generated before, or that arrived after.
  // The backend rejects propose and publish over it, so the screen must neither
  // claim the draft satisfies every hard rule nor offer the button (HGH5-02).
  const conflictCount = result?.unavailability_conflicts?.length ?? 0
  const conflictPeople = new Set((result?.unavailability_conflicts ?? []).map((item) => item.assignee_name)).size
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false)
  const [publishAcknowledged, setPublishAcknowledged] = useState(false)
  const [changeResolutions, setChangeResolutions] = useState<Record<string, 'draft' | 'change'>>({})
  const publishPreview = useQuery({
    queryKey: ['publish-preview', result?.id, result?.version],
    queryFn: () => api.publishPreview(result!.id),
    enabled: publishConfirmOpen && result?.status === 'proposed',
  })
  useEffect(() => { setChangeResolutions({}); setPublishAcknowledged(false) }, [result?.id, result?.version])
  const impact = useQuery({
    queryKey: ['draft-fairness-impact', result?.id, result?.version],
    queryFn: () => api.draftFairnessImpact(result!.id, result!.version),
    enabled: Boolean(result),
  })
  const [toDelete, setToDelete] = useState<ScheduleSummary | null>(null)
  const invalidateDrafts = () => {
    queryClient.invalidateQueries({ queryKey: ['active-runs'] })
    queryClient.invalidateQueries({ queryKey: ['draft-schedules'] })
    // Without this the ['schedule', id] entry keeps the pre-transition payload
    // for the global 30s staleTime and the effect above would rewind `result`.
    queryClient.invalidateQueries({ queryKey: ['schedule'] })
  }
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSchedule(id),
    onSuccess: (_data, id) => {
      setToDelete(null)
      if (openId === id) {
        setOpenId(null)
        setResult(null)
      }
      invalidateDrafts()
    },
  })
  // Rotation mode, the 11–19 anchor and the swap approval are stored policy,
  // not request parameters; they are written only on an explicit save, never
  // on change.
  const [settings, setSettings] = useState<Settings>({
    rotation_mode: 'hybrid',
    late_shift_anchor: 'secondary',
    fairness_weight: 3,
    continuity_weight: 1,
    preference_weight: 2,
    solve_seconds: 15,
    coordinator_swap_approval_required: true,
  })
  const storedSettings = (): Settings | null => (policy.data ? settingsOf(policy.data) : null)
  useEffect(() => {
    if (policy.data) setSettings(settingsOf(policy.data))
  }, [policy.data])
  const savePolicy = useMutation({
    mutationFn: (input: Settings) => api.updateSchedulingPolicy(input),
    onSuccess: (value) => queryClient.setQueryData(['scheduling-policy'], value),
  })
  const settingsDirty = Boolean(policy.data && SETTINGS_KEYS.some((key) => settings[key] !== policy.data[key]))
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
  const propose = useMutation({ mutationFn: (input: { id: string; expectedVersion: number }) => api.proposeSchedule(input), onSuccess: settle })
  const withdraw = useMutation({ mutationFn: (input: { id: string; expectedVersion: number }) => api.withdrawSchedule(input), onSuccess: settle })
  const publish = useMutation({
    mutationFn: (input: Parameters<typeof api.publishSchedule>[0]) => api.publishSchedule(input),
    onSuccess: (value) => {
      settle(value)
      setPublishConfirmOpen(false)
      queryClient.invalidateQueries({ queryKey: ['published-schedule'] })
      queryClient.invalidateQueries({ queryKey: ['calendar'] })
    },
  })
  const error = policy.error ?? savePolicy.error ?? generate.error ?? resume.error ?? propose.error ?? withdraw.error ?? publish.error ?? remove.error
  const counts = result ? problemCounts(result) : { hard: 0, soft: 0, total: 0 }
  const days = result ? new Set(result.assignments.map((item) => item.service_date)).size : 0
  const spread = impact.data ? worstSpread(impact.data) : null
  const generatingRange = generating ? (result && !generate.isPending ? result : range) : null
  const showProblems = (onlyHard: boolean) => {
    setHardOnly(onlyHard)
    problemsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
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

  const progress = generating && (
    <div className="panel panel-padded stack-sm" aria-live="polite">
      <Steps
        label={t.progress.stage}
        steps={[
          { label: t.progress.steps.data, state: runProgress?.status === 'queued' ? 'on' : 'done' },
          {
            label: runProgress?.status === 'running' && runProgress.solve_seconds !== undefined ? t.progress.steps.solverTimed(elapsed, Math.round(runProgress.solve_seconds)) : t.progress.steps.solver,
            state: runProgress?.status === 'running' ? 'on' : runProgress?.status === 'completed' ? 'done' : 'todo',
          },
          { label: t.progress.steps.fairness, state: runProgress?.status === 'completed' ? 'on' : 'todo' },
          { label: t.progress.steps.proposal, state: 'todo' },
        ]}
      />
      <div className="progress" role="progressbar" aria-valuenow={runProgress?.progress ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={t.progress.bar}>
        <i style={{ width: `${runProgress?.progress ?? 0}%` }} />
      </div>
      {Boolean(runProgress?.uncovered_before?.length) && (
        <Box tone="warn">
          {t.progress.uncoveredBefore(runProgress!.uncovered_before!.length, runProgress!.uncovered_before!.map(formatDate).join(', '))}
        </Box>
      )}
      <div className="small muted">
        {runProgress?.status === 'queued' ? queueSentence(runProgress) : t.progress.outOfProcess}
      </div>
      {/* The budget is per solver pass, and a hard model is solved several
          times over, so the counter can pass the budget without a defect.
          Outside the live region: it changes every second. */}
      {runProgress?.solve_seconds !== undefined && (
        <div className="small muted mono" aria-live="off">
          {t.progress.budgetLine(elapsed, Math.round(runProgress.solve_seconds))}
          {policy.data?.time_budget_seconds !== undefined && t.progress.budgetTotal(Math.round(policy.data.time_budget_seconds))}.
        </div>
      )}
      {resume.isPending && <div className="small muted">{t.progress.resumed}</div>}
    </div>
  )

  const settingsButton = (
    <Button variant="ghost" icon="settings" onClick={() => setSettingsOpen(true)}>
      {t.settingsButton}{settingsDirty ? t.settingsButtonUnsaved : ''}
    </Button>
  )

  const rangeForm = (
    <section className="stack-sm">
      <SectionHeading title={t.form.newDraft} meta={t.form.maxDays} />
      <form className="panel panel-padded stack-sm" onSubmit={(event) => { event.preventDefault(); generate.mutate(range) }} aria-label={t.form.newDraft}>
        <div className="frow">
          <DateField id="generator-from" label={t.form.from} value={range.starts_on} onChange={(value) => setRange({ ...range, starts_on: value })} required />
          <DateField id="generator-to" label={t.form.to} value={range.ends_on} onChange={(value) => setRange({ ...range, ends_on: value })} required />
          <div className="self-end">
            <Button type="submit" variant="primary" icon="wand" disabled={generating} loading={generating}>
              {generating ? (runProgress?.status === 'queued' ? t.form.queued : t.form.generating) : t.form.create}
            </Button>
          </div>
        </div>
        <div className="small muted">
          {t.form.savedSettings(rotationLabels()[policy.data?.rotation_mode ?? 'hybrid'], lateShiftAnchorLabels()[policy.data?.late_shift_anchor ?? 'secondary'])}
          {settingsDirty && <b>{t.form.unsavedNote}</b>}
          {t.form.splitLonger}
        </div>
        {range.starts_on === range.ends_on && range.starts_on !== '' && (
          <Box tone="warn" title={t.form.singleDayTitle}>
            {t.form.singleDayBody}
          </Box>
        )}
      </form>
    </section>
  )

  const draftsSection = (
    <section className="stack-sm">
      <SectionHeading title={t.drafts.heading} meta={drafts.data ? `${drafts.data.length}` : undefined} />
      <DraftList activeId={result?.id} onOpen={setOpenId} onDelete={setToDelete} deleting={remove.isPending} />
      {(drafts.data?.some((item) => item.rotation_mode === 'daily') && drafts.data.some((item) => item.rotation_mode === 'weekly')) && (
        <Disclosure title={t.drafts.compareVariants}>
          <ScheduleComparison drafts={drafts.data ?? []} />
        </Disclosure>
      )}
    </section>
  )

  return (
    <div className="page">
      {result ? (
        <PageHeader
          title={generating && generatingRange ? t.header.generating(formatRange(generatingRange.starts_on, generatingRange.ends_on)) : `${t.titleWord[result.status]} ${formatRange(result.starts_on, result.ends_on)}`}
          sub={(
            <>
              <StatusBadge tone={statusTone[result.status]}>{scheduleStatusLabels()[result.status]}</StatusBadge>
              <span>
                {t.header.versionLine(result.version, result.assignments.length, days, rotationLabels()[result.rotation_mode])}
              </span>
              <Tag tone={result.solver_status === 'OPTIMAL' ? 'sig' : SOLVER_OK.includes(result.solver_status) ? undefined : 'bad'}>{t.header.solverStatus(result.solver_status)}</Tag>
            </>
          )}
          actions={(
            <>
              {settingsButton}
              <Button icon="wand" disabled={generating} loading={generating} onClick={() => generate.mutate({ starts_on: result.starts_on, ends_on: result.ends_on })}>
                {t.header.regenerate}
              </Button>
              {result.status === 'draft' && (
                <Tooltip text={conflictCount > 0 ? t.proposeBlocked : t.header.proposeHint}>
                  <Button
                    variant="primary"
                    icon="send"
                    disabled={propose.isPending || conflictCount > 0 || generating}
                    loading={propose.isPending}
                    onClick={() => propose.mutate({ id: result.id, expectedVersion: result.version })}
                  >
                    {t.header.propose}
                  </Button>
                </Tooltip>
              )}
              {result.status === 'proposed' && (
                <>
                  <Button disabled={withdraw.isPending} loading={withdraw.isPending} onClick={() => withdraw.mutate({ id: result.id, expectedVersion: result.version })}>{t.header.backToDraft}</Button>
                  <Button variant="primary" icon="send" disabled={publish.isPending || generating} onClick={() => setPublishConfirmOpen(true)}>{t.header.publish}</Button>
                </>
              )}
              {result.status === 'published' && <StatusBadge tone="pub">{t.header.published}</StatusBadge>}
            </>
          )}
        />
      ) : (
        <PageHeader
          title={generating && generatingRange ? t.header.generating(formatRange(generatingRange.starts_on, generatingRange.ends_on)) : nav.screens.generator}
          sub={generating
            ? (runProgress?.status === 'queued' ? t.header.queuedSub : t.header.solverSub)
            : t.header.draftSub}
          actions={settingsButton}
        />
      )}
      {error && (
        <Box tone="bad" role="alert" title={error.message}>
          {(generate.error || resume.error) && runProgress?.conflicts && runProgress.conflicts.length > 0 && (
            <ul className="box-list">{runProgress.conflicts.map((conflict) => <li key={conflict}>{conflict}</li>)}</ul>
          )}
        </Box>
      )}
      {progress}
      {opened.isLoading && <p className="muted">{t.draft.opening}</p>}
      {opened.error && <ErrorState error={opened.error} onRetry={() => opened.refetch()} />}
      {!result && rangeForm}
      {result && (
        <section className="stack" aria-label={result.name}>
          <Steps
            label={t.draft.stage}
            steps={STAGES.map((stage) => ({
              label: <><b>{scheduleStatusLabels()[stage]}</b> <small>{t.stageActors[stage]}</small></>,
              state: STAGES.indexOf(stage) < STAGES.indexOf(result.status) ? 'done' : stage === result.status ? 'on' : 'todo',
            }))}
          />
          {result.status === 'draft' && conflictCount > 0 && <span className="small who-bad">{t.proposeBlocked}</span>}
          <ChipRow label={t.draft.state}>
            <Chip tone={SOLVER_OK.includes(result.solver_status) ? 'ok' : 'bad'}>
              {t.draft.staffing(days, result.assignments.length)}
            </Chip>
            <Chip tone={counts.hard === 0 ? 'ok' : 'bad'} onClick={() => showProblems(true)} title={t.draft.showInProblems}>
              {t.draft.hardRules(counts.hard)}
            </Chip>
            {counts.soft > 0 && (
              <Chip tone="warn" onClick={() => showProblems(false)} title={t.draft.showInProblems}>
                {t.draft.softWarnings(counts.soft)}
              </Chip>
            )}
            {spread && (
              <Chip tone="sig">{t.draft.spreadAfter(formatPoints(spread.after))}</Chip>
            )}
          </ChipRow>
          {result.solver_status === 'FEASIBLE' && conflictCount === 0 && (
            <Box tone="muted">
              {t.draft.quality(
                result.fairness_proven ? t.draft.fairnessProven : t.draft.fairnessBestFound,
                result.continuity_gap == null
                  ? t.draft.noGapEstimate
                  : t.draft.gap(new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(result.continuity_gap * 100)),
              )}
            </Box>
          )}
          {conflictCount > 0 && (
            <Box tone="bad" role="alert" title={t.draft.conflictTitle(conflictPeople)}>
              {result.status === 'draft' ? t.draft.conflictEditable : t.draft.conflictLocked}
            </Box>
          )}
          {!SOLVER_OK.includes(result.solver_status) && (
            <Box tone="warn" title={t.draft.solverIncompleteTitle(result.solver_status)}>
              {t.draft.solverIncompleteBody}
            </Box>
          )}
          <div className="split split-wide">
            <div className="stack">
              <SectionHeading
                as="h3"
                title={t.draft.proposedStaffing}
                meta={`${formatRange(result.starts_on, result.ends_on)}${result.status === 'draft' ? t.draft.clickToCorrect : ''}`}
                controls={<LegendPopover showAvailability trigger={<button type="button" className="sech-link">{t.draft.legend}</button>} />}
              />
              <DraftScheduleMatrix result={result} onChange={setResult} focus={focus} />
              <div ref={problemsRef}>
                <SectionHeading
                  as="h3"
                  title={t.draft.problems}
                  meta={counts.total === 0 ? t.draft.problemsNone : t.draft.problemsMeta(counts.soft, counts.hard)}
                  controls={counts.total > 0 && (
                    <>
                      <Segmented<ProblemGrouping>
                        size="sm"
                        label={t.draft.problemGrouping}
                        value={problemsBy}
                        onChange={setProblemsBy}
                        options={[{ value: 'person', label: t.draft.byPerson }, { value: 'rule', label: t.draft.byRule }]}
                      />
                      <button type="button" className={cx('sech-link', hardOnly && 'on')} aria-pressed={hardOnly} onClick={() => setHardOnly((value) => !value)}>{t.draft.hardOnly}</button>
                    </>
                  )}
                />
              </div>
              <DraftProblems result={result} onFocus={setFocus} editable={result.status === 'draft'} by={problemsBy} hardOnly={hardOnly} />
            </div>
            <div className="stack">
              <SectionHeading as="h3" title={t.draft.fairnessAfter} meta={t.draft.fairnessWindow} />
              <DraftFairnessPanel result={result} />
              <SectionHeading as="h3" title={t.draft.proposalSettings} />
              <div className="panel panel-padded stack-sm">
                <KeyValue
                  items={[
                    { key: t.draft.range, value: t.draft.rangeValue(formatDate(result.starts_on), formatDate(result.ends_on)), mono: true },
                    { key: t.draft.version, value: t.draft.versionValue(result.version), mono: true },
                    { key: t.draft.rotationMode, value: rotationLabels()[result.rotation_mode] },
                    { key: t.draft.lateShiftAnchor(roleLabels().late_shift), value: lateShiftAnchorLabels()[policy.data?.late_shift_anchor ?? 'secondary'] },
                    { key: t.draft.fairnessWeight, value: policy.data?.fairness_weight ?? t.draft.unknown, mono: true },
                    { key: t.draft.preferenceWeight, value: policy.data?.preference_weight ?? t.draft.unknown, mono: true },
                    { key: t.draft.continuityWeight, value: policy.data?.continuity_weight ?? t.draft.unknown, mono: true },
                    { key: t.draft.solverBudget, value: policy.data ? t.draft.solverBudgetValue(policy.data.solve_seconds) : t.draft.unknown, mono: true },
                  ]}
                />
                <p className="muted small">{t.draft.weightsNote}</p>
                <Button size="sm" variant="ghost" className="self-start" onClick={() => setSettingsOpen(true)}>{t.draft.changeAndRegenerate}</Button>
              </div>
            </div>
          </div>
        </section>
      )}
      {draftsSection}
      <ConfirmDialog
        open={Boolean(toDelete)}
        pending={remove.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        title={t.deleteDialog.title}
        confirmLabel={t.deleteDialog.confirm}
        confirmColor="error"
        description={toDelete && t.deleteDialog.description(toDelete.name, formatDate(toDelete.starts_on), formatDate(toDelete.ends_on))}
      />
      <Panel
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        wide
        title={t.settings.title}
        meta={settingsDirty && <StatusBadge tone="warn">{t.settings.unsaved}</StatusBadge>}
        footer={(
          <>
            <Button size="sm" variant="ghost" disabled={!settingsDirty} onClick={() => { const stored = storedSettings(); if (stored) setSettings(stored) }}>{t.settings.restore}</Button>
            <span className="sp" />
            <Button type="submit" form="generator-settings" variant={settingsDirty ? 'primary' : 'default'} disabled={savePolicy.isPending || policy.isLoading || !settingsDirty} loading={savePolicy.isPending}>
              {savePolicy.isPending ? common.saving : t.settings.save}
            </Button>
            <Button
              variant="primary"
              icon="wand"
              disabled={generating || settingsDirty}
              onClick={() => { setSettingsOpen(false); generate.mutate(result ? { starts_on: result.starts_on, ends_on: result.ends_on } : range) }}
            >
              {t.settings.generate}
            </Button>
          </>
        )}
      >
        <form id="generator-settings" className="stack-sm" onSubmit={(event) => { event.preventDefault(); savePolicy.mutate(settings) }} aria-label={t.settings.form}>
          <div className="frow">
            <DateField id="settings-from" label={t.form.from} value={result?.starts_on ?? range.starts_on} onChange={(value) => setRange({ ...range, starts_on: value })} disabled={Boolean(result)} />
            <DateField id="settings-to" label={t.form.to} value={result?.ends_on ?? range.ends_on} onChange={(value) => setRange({ ...range, ends_on: value })} disabled={Boolean(result)} hint={result ? t.settings.rangeOfOpenDraft : t.settings.maxDays} />
          </div>
          <Box tone="muted">
            {t.settings.globalNote}
          </Box>
          <div className="frow">
            <Field label={t.settings.rotationMode} id="policy-rotation-mode" hint={t.settings.rotationModeHint}>
              {({ id, describedBy }) => (
                <Select id={id} name="rotation_mode" value={settings.rotation_mode} disabled={policy.isLoading} aria-describedby={describedBy} onChange={(event) => setSettings({ ...settings, rotation_mode: event.target.value as RotationMode })}>
                  {Object.entries(rotationLabels()).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              )}
            </Field>
            <Field label={t.settings.lateShiftAnchor} id="policy-late-shift-anchor" hint={t.settings.lateShiftAnchorHint}>
              {({ id, describedBy }) => (
                <Select id={id} name="late_shift_anchor" value={settings.late_shift_anchor} disabled={policy.isLoading} aria-describedby={describedBy} onChange={(event) => setSettings({ ...settings, late_shift_anchor: event.target.value as LateShiftAnchor })}>
                  {Object.entries(lateShiftAnchorLabels()).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              )}
            </Field>
          </div>
          {settings.rotation_mode === 'weekly' && (
            <Box tone="warn" title={t.settings.weeklyTitle}>
              {t.settings.weeklyBody}
            </Box>
          )}
          <Checkbox
            name="coordinator_swap_approval_required"
            label={t.settings.swapApproval}
            hint={t.settings.swapApprovalHint}
            checked={settings.coordinator_swap_approval_required}
            disabled={policy.isLoading}
            onChange={(event) => setSettings({ ...settings, coordinator_swap_approval_required: event.target.checked })}
          />
          <div className="frow">
            {numberField('fairness_weight', t.settings.fairnessWeight, t.settings.fairnessWeightHint, 0, 100, 0.5)}
            {numberField('preference_weight', t.settings.preferenceWeight, t.settings.preferenceWeightHint, 0, 100, 0.5)}
          </div>
          <div className="frow">
            {numberField('continuity_weight', t.settings.continuityWeight, t.settings.continuityWeightHint, 0, 100, 0.5)}
            {numberField('solve_seconds', t.settings.solveSeconds, t.settings.solveSecondsHint(Math.round((settings.solve_seconds || 0) * GENERATION_BUDGET_PASSES)), 5, 300, 5)}
          </div>
          <Box tone="sig" title={t.settings.startingPointsTitle}>
            {t.settings.startingPointsBody}
          </Box>
          {savePolicy.isSuccess && !settingsDirty && <span className="small muted">{t.settings.saved}</span>}
        </form>
      </Panel>
      {result && (
        <Dialog
          open={publishConfirmOpen}
          onOpenChange={setPublishConfirmOpen}
          dismissible={!publish.isPending}
          size="lg"
          title={t.publish.title(result.status === 'proposed', result.version, formatRange(result.starts_on, result.ends_on))}
          actions={(
            <>
              <Button onClick={() => setPublishConfirmOpen(false)} disabled={publish.isPending}>{t.publish.back}</Button>
              <Button
                variant="primary"
                loading={publish.isPending}
                disabled={publish.isPending || publishPreview.isLoading || publishPreview.isError
                  || (result.starts_on <= today && !publishAcknowledged)
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
                {publish.isPending ? t.publish.publishing : t.publish.publishVersion(result.version)}
              </Button>
            </>
          )}
        >
          <ul>
            <li><b>{t.publish.assignments(result.assignments.length)}</b> {t.publish.becomePublished(result.assignments.length, days)}</li>
            <li>{t.publish.earlierSchedule}</li>
            {counts.soft > 0 && <li><b>{t.draft.softWarnings(counts.soft)}</b> {t.publish.softWarningsAudited(counts.soft)}</li>}
            {publishPreview.data?.pending_swaps.length ? <li><b>{t.publish.pendingSwaps(publishPreview.data.pending_swaps.length)}</b> {t.publish.pendingSwapsCancelled(publishPreview.data.pending_swaps.length)}</li> : null}
          </ul>
          {result.starts_on <= today && (
            <Box tone="warn" title={t.publish.todayTitle}>{t.publish.todayBody}</Box>
          )}
          {publishPreview.isLoading && <p className="muted">{t.publish.checking}</p>}
          {publishPreview.error && <Box tone="bad" role="alert" title={t.publish.checkFailed} />}
          {publishPreview.data?.lost_changes.length ? (
            <Box tone="warn" title={t.publish.resolveConflicts}>
              <div className="stack-sm" style={{ marginTop: 6 }}>
                {publishPreview.data.lost_changes.map((change) => (
                  <div key={`${change.service_date}-${change.role}`} className="stack-sm">
                    <div>
                      <span className="mono">{formatDayShort(change.service_date)}</span> · {t.publish.lostChange(roleLabels()[change.role], change.previous_assignee_name, change.new_assignee_name, change.reason ?? '')}
                    </div>
                    <Field label={t.publish.decision} id={`resolution-${change.service_date}-${change.role}`}>
                      {({ id }) => (
                        <Select
                          id={id}
                          value={changeResolutions[`${change.service_date}:${change.role}`] ?? ''}
                          onChange={(event) => setChangeResolutions((current) => ({ ...current, [`${change.service_date}:${change.role}`]: event.target.value as 'draft' | 'change' }))}
                        >
                          <option value="">{t.publish.choose}</option>
                          <option value="draft">{t.publish.keepDraft}</option>
                          <option value="change">{t.publish.keepChange}</option>
                        </Select>
                      )}
                    </Field>
                  </div>
                ))}
              </div>
            </Box>
          ) : null}
          {publishPreview.data?.carried_changes.length ? (
            <Box tone="ok" title={t.publish.carried}>
              <ul className="box-list">
                {publishPreview.data.carried_changes.map((change) => (
                  <li key={`${change.service_date}-${change.role}`}>{t.publish.carriedItem(formatDayShort(change.service_date), roleLabels()[change.role], change.previous_assignee_name)}</li>
                ))}
              </ul>
            </Box>
          ) : null}
          {publishPreview.data?.pending_swaps.length ? (
            <Box tone="sig" title={t.publish.cancelledSwaps}>
              <ul className="box-list">
                {publishPreview.data.pending_swaps.map((swap) => (
                  <li key={swap.id}>{t.publish.cancelledSwap(formatDayShort(swap.service_date), roleLabels()[swap.role], swap.requester_name, swap.replacement_name)}</li>
                ))}
              </ul>
            </Box>
          ) : null}
          {publishPreview.data?.uncovered_before.length ? (
            <Box tone="warn" title={t.publish.gapTitle}>{t.publish.gapBody(publishPreview.data.uncovered_before.map(formatDate).join(', '))}</Box>
          ) : null}
          {publishPreview.data?.stale_changes_count ? (
            <Box tone="warn" title={t.publish.staleTitle(publishPreview.data.stale_changes_count)} />
          ) : null}
          {publishPreview.data?.rest_violations.length ? (
            <Box tone="bad" title={t.publish.restTitle}>
              <ul className="box-list">
                {publishPreview.data.rest_violations.map((violation) => (
                  <li key={`${violation.member_name}-${violation.rule}`}>{t.publish.restItem(violation.member_name, violation.message, violation.days.map(formatDate).join(', '))}</li>
                ))}
              </ul>
            </Box>
          ) : null}
          {result.starts_on <= today && (
            <Checkbox
              label={t.publish.acknowledge}
              checked={publishAcknowledged}
              onChange={(event) => setPublishAcknowledged(event.target.checked)}
            />
          )}
          <p className="muted small">{t.publish.undoNote}</p>
        </Dialog>
      )}
    </div>
  )
}
