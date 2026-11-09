import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DraftSchedule, LateShiftAnchor, RotationMode, ScheduleRun, ScheduleSummary, SchedulingPolicy, api } from '../api'
import { locale, messages, useMessages } from '../i18n'
import { lateShiftAnchorLabels, lensLabels, roleLabels, rotationLabels, scheduleStatusLabels } from '../lib/labels'
import { preferredScrollBehavior } from '../lib/motion'
import { groupByKey } from '../lib/calendar'
import { draftFairnessImpactQuery } from '../lib/fairness'
import { addDays, formatDate, formatDayShort, formatRange, isIsoDate, warsawDate } from '../lib/dates'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog'
import { DraftFocus, DraftScheduleMatrix } from '../components/DraftScheduleMatrix'
import { DraftFairnessPanel } from '../components/DraftFairnessPanel'
import { DraftDecision, PublicationEffects } from '../components/DraftDecision'
import { SOLVER_OK, problemCounts } from '../lib/draftProblems'
import { DraftList } from '../components/DraftList'
import { DraftProblems, ProblemGrouping } from '../components/DraftProblems'
import { LegendPopover } from '../components/MatrixControls'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { AcknowledgeBox } from '../components/DecisionFrame'
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
  IconButton,
  Input,
  KeyValue,
  PageHeader,
  Panel,
  Popover,
  SectionHeading,
  Segmented,
  Select,
  StatusBadge,
  StatusTone,
  Steps,
  Menu,
  MenuItem,
  TabPanel,
  Tabs,
  Tooltip,
  cx,
  useToast,
} from '../ui'

/** Mirrors `scheduler.GENERATION_BUDGET_PASSES`; only for the live preview
 *  while the coordinator is still typing an unsaved budget. */
const GENERATION_BUDGET_PASSES = 4

/** Count of generations ahead in the queue, in the current language. */
function jobsAhead(count: number): string {
  return messages().generator.jobsAhead(count)
}

/** The sentence under the progress bar while a generation waits its turn. */
function queueSentence(run: ScheduleRun): string {
  const t = messages().generator.queue
  if (!run.queue_position) return t.waitingForWorker
  const start = run.estimated_start_seconds
  return start && start > 0 ? t.positionWithEta(jobsAhead(run.queue_position), start) : t.position(jobsAhead(run.queue_position))
}

type DraftTab = 'problems' | 'fairness' | 'settings' | 'drafts'

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
 * of drafts; with one it is the proposal page: the range as the title, one
 * decision panel with the verdict and the next action, the risk row, the
 * staffing matrix, and under it the problems, the balance after
 * publication, the draft's own settings and the other drafts as tabs. The
 * team settings live in one drawer, the publication in a sheet that holds
 * only what has to be decided or consented to.
 */
export function GeneratorPanel() {
  const { generator: t, common, nav } = useMessages()
  const queryClient = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const moreRef = useRef<HTMLButtonElement>(null)
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
  const [settingsFromMenu, setSettingsFromMenu] = useState(false)
  const openSettings = (fromMenu: boolean) => {
    setSettingsFromMenu(fromMenu)
    setSettingsOpen(true)
  }
  const [problemsBy, setProblemsBy] = useState<ProblemGrouping>('person')
  const [hardOnly, setHardOnly] = useState(false)
  const [tab, setTab] = useState<DraftTab>('problems')
  const tabsRef = useRef<HTMLDivElement>(null)
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
  // The schedule the publication sheet is open for; showing another closes it.
  const [publishFor, setPublishFor] = useState<string | null>(null)
  const publishConfirmOpen = result !== null && publishFor === result.id
  // The proposal "Opublikuj…" made from a draft in the background; closing
  // the sheet without publishing takes it back, so the draft stays as it was.
  const [backgroundProposal, setBackgroundProposal] = useState<{ id: string; expectedVersion: number } | null>(null)
  const publishFromDraft = backgroundProposal !== null
  const [publishAcknowledged, setPublishAcknowledged] = useState(false)
  const [changeResolutions, setChangeResolutions] = useState<Record<string, 'draft' | 'change'>>({})
  const publishPreview = useQuery({
    queryKey: ['publish-preview', result?.id, result?.version],
    queryFn: () => api.publishPreview(result!.id),
    // The page states what the publication changes before the sheet opens.
    enabled: result?.status === 'proposed',
  })
  useEffect(() => { setChangeResolutions({}); setPublishAcknowledged(false) }, [result?.id, result?.version])
  // Each kind of violation the publication carries is consented to on its own,
  // and only for the preview it was shown with.
  /** The rules broken by the publication that the coordinator consented to break, one consent per rule. */
  const [restAcknowledged, setRestAcknowledged] = useState<ReadonlySet<string>>(new Set())
  const [gapAcknowledged, setGapAcknowledged] = useState(false)
  useEffect(() => { setRestAcknowledged(new Set()); setGapAcknowledged(false) }, [publishPreview.data])
  const impact = useQuery(draftFairnessImpactQuery(result))
  const [toDelete, setToDelete] = useState<ScheduleSummary | null>(null)
  const invalidateDrafts = () => {
    queryClient.invalidateQueries({ queryKey: ['active-runs'] })
    queryClient.invalidateQueries({ queryKey: ['draft-schedules'] })
    // Without this the ['schedule', id] entry keeps the pre-transition payload
    // for the global 30s staleTime and the effect above would rewind `result`.
    queryClient.invalidateQueries({ queryKey: ['schedule'] })
  }
  // A correction or its Undo can land after the coordinator opened another
  // draft or closed this one; it then only refreshes the stored copies.
  const shownId = useRef<string | undefined>(undefined)
  useEffect(() => {
    shownId.current = result?.id
    return () => { shownId.current = undefined }
  }, [result?.id])
  const correct = (value: DraftSchedule) => {
    if (shownId.current === value.id) {
      setResult(value)
      proposeToPublish.reset()
    } else invalidateDrafts()
  }
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
  useEffect(() => {
    if (policy.data) setSettings(settingsOf(policy.data))
  }, [policy.data])
  const savePolicy = useMutation({
    mutationFn: (input: Settings) => api.updateSchedulingPolicy(input),
    onSuccess: (value) => {
      queryClient.setQueryData(['scheduling-policy'], value)
      toast.success(t.toast.settingsSaved)
    },
  })
  const settingsDirty = Boolean(policy.data && SETTINGS_KEYS.some((key) => settings[key] !== policy.data[key]))
  const unsavedChanges = useUnsavedChanges(settingsDirty, () => setSettings(settingsOf(policy.data!)))
  const closeSettings = () => unsavedChanges.requestAction(() => setSettingsOpen(false))
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSchedule(id),
    onSuccess: (_data, id) => {
      setToDelete(null)
      if (openId === id) {
        unsavedChanges.bypass(() => setOpenId(null))
        setResult(null)
      }
      invalidateDrafts()
    },
  })
  const onGenerated = (value: DraftSchedule) => {
    setRunProgress(null)
    setResult(value)
    unsavedChanges.bypass(() => setOpenId(value.id))
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
    if (shownId.current === value.id) setResult(value)
    invalidateDrafts()
  }
  const propose = useMutation({
    mutationFn: (input: { id: string; expectedVersion: number }) => api.proposeSchedule(input),
    onSuccess: (value) => {
      settle(value)
      toast.success(t.toast.proposed(formatRange(value.starts_on, value.ends_on)))
    },
  })
  const withdraw = useMutation({
    mutationFn: (input: { id: string; expectedVersion: number; quiet?: boolean }) => api.withdrawSchedule(input),
    onSuccess: (value, { quiet }) => {
      settle(value)
      if (!quiet) toast.success(t.toast.withdrawn(formatRange(value.starts_on, value.ends_on)))
    },
  })
  const publish = useMutation({
    mutationFn: (input: Parameters<typeof api.publishSchedule>[0]) => api.publishSchedule(input),
    onSuccess: (value) => {
      settle(value)
      setPublishFor(null)
      setBackgroundProposal(null)
      queryClient.invalidateQueries({ queryKey: ['published-schedule'] })
      // The range just published is no longer the next one to generate.
      queryClient.invalidateQueries({ queryKey: ['suggested-schedule-range'] })
      queryClient.invalidateQueries({ queryKey: ['calendar'] })
      toast.success(t.toast.published(formatRange(value.starts_on, value.ends_on)), {
        description: t.toast.publishedDescription,
        action: { label: t.toast.openSchedule, onClick: () => navigate(`/grafik?od=${value.starts_on}`) },
      })
    },
  })
  // What the sheet shows is read again each time it opens.
  const openPublication = (id: string) => {
    publish.reset()
    setPublishFor(id)
    publishPreview.refetch()
  }
  // Publishing straight from a draft hands it over in the background and
  // opens the sheet only once its effects are known.
  const proposeToPublish = useMutation({
    mutationFn: async (input: { id: string; expectedVersion: number }) => {
      const proposal = await api.proposeSchedule(input)
      try {
        return { proposal, effects: await api.publishPreview(proposal.id) }
      } catch (error_) {
        await api.withdrawSchedule({ id: proposal.id, expectedVersion: proposal.version })
        throw error_
      }
    },
    onSuccess: ({ proposal, effects }) => {
      // The coordinator moved on before the effects were known.
      if (shownId.current !== proposal.id) {
        withdraw.mutate({ id: proposal.id, expectedVersion: proposal.version, quiet: true })
        return
      }
      queryClient.setQueryData(['publish-preview', proposal.id, proposal.version], effects)
      settle(proposal)
      publish.reset()
      setBackgroundProposal({ id: proposal.id, expectedVersion: proposal.version })
      setPublishFor(proposal.id)
    },
    onError: () => invalidateDrafts(),
  })
  const closePublication = () => {
    setPublishFor(null)
    if (backgroundProposal) withdraw.mutate({ ...backgroundProposal, quiet: true })
    setBackgroundProposal(null)
  }
  useEffect(() => {
    if (publishFor !== null && publishFor !== result?.id) closePublication()
    // Only a change of the shown schedule closes the sheet it was opened for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.id])
  // Leaving the generator with the sheet open takes the draft back as well.
  const leftBehind = useRef(backgroundProposal)
  useEffect(() => { leftBehind.current = backgroundProposal }, [backgroundProposal])
  useEffect(() => () => {
    if (leftBehind.current) withdraw.mutate({ ...leftBehind.current, quiet: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const error = policy.error ?? savePolicy.error ?? generate.error ?? resume.error ?? propose.error ?? withdraw.error
  const counts = result ? problemCounts(result) : { hard: 0, soft: 0, total: 0 }
  const days = result ? new Set(result.assignments.map((item) => item.service_date)).size : 0
  // The range being generated: what the running request asked for, else the
  // draft whose interrupted run is being rejoined.
  const generatingRange = generating ? (generate.isPending ? generate.variables : result ?? range) : null
  // A new draft over the open one's range: the open one stays as it was,
  // corrections and all, so say where it went.
  const generateRange = () => result
    ? generate.mutate(
      { starts_on: result.starts_on, ends_on: result.ends_on },
      { onSuccess: () => toast.success(t.header.newDraftCreated) },
    )
    : generate.mutate(range)
  const generateFromSettings = () => {
    setSettingsOpen(false)
    generateRange()
  }
  const showSoftProblems = () => {
    setHardOnly(false)
    setTab('problems')
    tabsRef.current?.scrollIntoView({ block: 'start', behavior: preferredScrollBehavior() })
  }
  // Lenses grouped by verdict: one chip for those meeting the criterion, one for the rest.
  const lensGroups = impact.data ? ([true, false] as const).map((meets) => ({
    meets,
    lenses: impact.data.spreads.filter((item) => item.meets_criterion === meets).map((item) => lensLabels()[item.lens] ?? item.lens),
  })).filter((group) => group.lenses.length > 0) : []
  // What the publication sheet still waits for, said next to its button.
  const preview = publishPreview.data
  const unresolvedConflicts = preview?.lost_changes.filter((item) => !changeResolutions[`${item.service_date}:${item.role}`]).length ?? 0
  const restGroups = groupByKey(preview?.rest_violations ?? [], (violation) => violation.rule)
  const missingConsents = [
    result !== null && result.starts_on <= today && !publishAcknowledged,
    ...[...restGroups.keys()].map((rule) => !restAcknowledged.has(rule)),
    Boolean(preview?.uncovered_before.length) && !gapAcknowledged,
  ].filter(Boolean).length
  const publishBlocked = publishPreview.isFetching || publishPreview.isError || !preview || unresolvedConflicts + missingConsents > 0
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

  const liveStage = runProgress?.status === 'queued'
    ? t.progress.steps.data
    : runProgress?.status === 'completed'
      ? t.progress.steps.fairness
      : t.progress.steps.solver
  const liveAnnouncement = generating
    ? runProgress ? t.progress.live(liveStage) : t.progress.liveStarting
    : ''
  const progress = generating && (
    <div className="panel panel-padded stack-sm">
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
        <i style={{ transform: `scaleX(${(runProgress?.progress ?? 0) / 100})` }} />
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
    <Button variant="ghost" icon="settings" onClick={() => openSettings(false)}>
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

  const draftList = (
    <>
      <DraftList activeId={result?.id} onOpen={setOpenId} onDelete={(item) => { remove.reset(); setToDelete(item) }} deleting={remove.isPending} />
      {(drafts.data?.some((item) => item.rotation_mode === 'daily') && drafts.data.some((item) => item.rotation_mode === 'weekly')) && (
        <Disclosure title={t.drafts.compareVariants}>
          <ScheduleComparison drafts={drafts.data} />
        </Disclosure>
      )}
    </>
  )

  return (
    <div className="page">
      {result ? (
        <PageHeader
          title={generating && generatingRange ? t.header.generating(formatRange(generatingRange.starts_on, generatingRange.ends_on)) : (
            <>
              {formatRange(result.starts_on, result.ends_on)}
              {' '}
              <StatusBadge tone={statusTone[result.status]} className="ph-pill">{t.header.statusPill(scheduleStatusLabels()[result.status], result.status === 'draft' ? result.version : null)}</StatusBadge>
            </>
          )}
          sub={t.header.summary(result.assignments.length, days, rotationLabels()[result.rotation_mode])}
          actions={(
            <>
              <Tooltip text={t.header.newDraftHint}>
                <Button icon="wand" disabled={generating} loading={generating} onClick={generateRange}>
                  {t.header.newDraft}
                </Button>
              </Tooltip>
              <Menu trigger={<IconButton ref={moreRef} label={t.header.more} icon="more" />}>
                <MenuItem onClick={() => openSettings(true)}>{t.settingsButton}{settingsDirty ? t.settingsButtonUnsaved : ''}</MenuItem>
              </Menu>
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
      <div role="region" aria-label={t.progress.bar} aria-live="polite" className="sr-only">{liveAnnouncement}</div>
      {progress}
      {opened.isLoading && <p className="muted">{t.draft.opening}</p>}
      {opened.error && <ErrorState error={opened.error} onRetry={() => opened.refetch()} />}
      {!result && rangeForm}
      {result && (
        // The page heading names the draft; a second, hidden one only repeated it.
        <section className="stack">
          <DraftDecision
            result={result}
            preview={preview}
            busy={generating || propose.isPending || proposeToPublish.isPending || withdraw.isPending || publish.isPending}
            error={proposeToPublish.variables?.id === result.id ? proposeToPublish.error?.message : undefined}
            onFix={setFocus}
            onPropose={() => propose.mutate({ id: result.id, expectedVersion: result.version })}
            onPublish={() => result.status === 'draft' ? proposeToPublish.mutate({ id: result.id, expectedVersion: result.version }) : openPublication(result.id)}
            onWithdraw={() => withdraw.mutate({ id: result.id, expectedVersion: result.version })}
          />
          <ChipRow label={t.draft.state}>
            <Chip tone={SOLVER_OK.has(result.solver_status) ? 'ok' : 'bad'}>
              {t.draft.staffing(days, result.assignments.length)}
            </Chip>
            {counts.soft > 0 && (
              <Chip tone="warn" onClick={showSoftProblems} title={t.draft.showInProblems}>
                {t.draft.softWarnings(counts.soft)}
              </Chip>
            )}
            {lensGroups.map((group) => (
              <Chip key={String(group.meets)} tone={group.meets ? 'ok' : 'warn'}>
                {t.draft.lenses(group.lenses.join(', '), group.meets)}
              </Chip>
            ))}
          </ChipRow>
          <SectionHeading
            title={result.status === 'published' || result.status === 'superseded' ? t.draft.publishedStaffing : t.draft.proposedStaffing}
            meta={`${formatRange(result.starts_on, result.ends_on)}${result.status === 'draft' ? t.draft.clickToCorrect : ''}`}
            controls={<LegendPopover showAvailability trigger={<button type="button" className="sech-link">{t.draft.legend}</button>} />}
          />
          <DraftScheduleMatrix result={result} onChange={correct} focus={focus} />
          <div ref={tabsRef} className="stack-sm">
            <Tabs<DraftTab>
              value={tab}
              onChange={setTab}
              label={t.draft.tabs.label}
              items={[
                { value: 'problems', label: t.draft.tabs.problems, count: counts.total },
                { value: 'fairness', label: t.draft.tabs.fairness },
                { value: 'settings', label: t.draft.tabs.settings },
                { value: 'drafts', label: t.draft.tabs.drafts, count: drafts.data?.length },
              ]}
            >
              <TabPanel<DraftTab> value="problems" className="stack-sm">
                {counts.total > 0 && (
                  <div className="row">
                    <Segmented<ProblemGrouping>
                      size="sm"
                      label={t.draft.problemGrouping}
                      value={problemsBy}
                      onChange={setProblemsBy}
                      options={[{ value: 'person', label: t.draft.byPerson }, { value: 'rule', label: t.draft.byRule }]}
                    />
                    <button type="button" className={cx('sech-link', hardOnly && 'on')} aria-pressed={hardOnly} onClick={() => setHardOnly((value) => !value)}>{t.draft.hardOnly}</button>
                  </div>
                )}
                <DraftProblems result={result} onFocus={setFocus} editable={result.status === 'draft'} by={problemsBy} hardOnly={hardOnly} />
              </TabPanel>
              <TabPanel<DraftTab> value="fairness" className="stack-sm">
                <p className="muted small">{t.draft.fairnessWindow}</p>
                <DraftFairnessPanel result={result} />
              </TabPanel>
              <TabPanel<DraftTab> value="settings">
                <div className="panel panel-padded stack-sm">
                  <KeyValue
                    items={[
                      { key: t.draft.range, value: t.draft.rangeValue(formatDate(result.starts_on), formatDate(result.ends_on)), mono: true },
                      { key: t.draft.version, value: t.draft.versionValue(result.version), mono: true },
                      { key: t.draft.rotationMode, value: rotationLabels()[result.rotation_mode] },
                      {
                        key: t.draft.solver,
                        value: (
                          <>
                            {t.header.solverStatus(result.solver_status)}
                            {' '}
                            <Popover title={t.header.solverDetails} trigger={<button type="button" className="link-btn small">{t.header.solverDetails}</button>}>
                              <div className="stack-sm small">
                                <div>{t.header.solverEngine(result.solver_status)}</div>
                                {result.continuity_gap != null && (
                                  <div>{t.draft.gap(new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(result.continuity_gap * 100))}</div>
                                )}
                              </div>
                            </Popover>
                          </>
                        ),
                      },
                      ...(SOLVER_OK.has(result.solver_status) ? [
                        { key: t.draft.fairness, value: result.fairness_proven ? t.draft.fairnessProven : t.draft.fairnessBestFound },
                      ] : []),
                    ]}
                  />
                  <p className="muted small">{t.draft.weightsNote}</p>
                  <Button size="sm" variant="ghost" className="self-start" onClick={() => openSettings(false)}>{t.draft.changeAndRegenerate}</Button>
                </div>
              </TabPanel>
              <TabPanel<DraftTab> value="drafts" className="stack-sm">
                {draftList}
              </TabPanel>
            </Tabs>
          </div>
        </section>
      )}
      {!result && (
        <section className="stack-sm">
          <SectionHeading title={t.drafts.heading} meta={drafts.data ? `${drafts.data.length}` : undefined} />
          {draftList}
        </section>
      )}
      <ConfirmDialog
        open={Boolean(toDelete)}
        pending={remove.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        title={t.deleteDialog.title}
        confirmLabel={t.deleteDialog.confirm}
        confirmColor="error"
        description={toDelete && t.deleteDialog.description(toDelete.name, formatDate(toDelete.starts_on), formatDate(toDelete.ends_on), toDelete.version, toDelete.override_count)}
        error={remove.error ? remove.error.message : null}
      />
      <Panel
        open={settingsOpen}
        onClose={closeSettings}
        finalFocus={settingsFromMenu ? moreRef : undefined}
        wide
        title={t.settings.title}
        meta={settingsDirty && <StatusBadge tone="warn">{t.settings.unsaved}</StatusBadge>}
        footer={(
          <>
            {/* Restoring and saving alone exist only for a change; untouched, the drawer only generates. */}
            {settingsDirty && <IconButton icon="undo" label={t.settings.restore} onClick={() => setSettings(settingsOf(policy.data!))} />}
            <span className="sp" />
            {settingsDirty && (
              <Button type="submit" form="generator-settings" disabled={savePolicy.isPending}>
                {t.settings.save}
              </Button>
            )}
            <Button
              variant="primary"
              icon="wand"
              disabled={generating || savePolicy.isPending || policy.isLoading}
              loading={savePolicy.isPending}
              // Changed settings are stored first, so the generation reads them.
              onClick={() => settingsDirty ? savePolicy.mutate(settings, { onSuccess: generateFromSettings }) : generateFromSettings()}
            >
              {savePolicy.isPending ? common.saving : settingsDirty ? t.settings.saveAndGenerate : t.settings.generate}
            </Button>
          </>
        )}
      >
        <form id="generator-settings" className="stack-sm" onSubmit={(event) => { event.preventDefault(); savePolicy.mutate(settings) }} aria-label={t.settings.form}>
          {/* The range is set on the page, once; the drawer only says which one it generates. */}
          <p className="small muted">
            {t.settings.range(formatRange((result ?? range).starts_on, (result ?? range).ends_on))}
            {' '}
            {result ? t.settings.rangeOfOpenDraft : t.settings.rangeOfForm}
          </p>
          <Box tone="muted">
            {t.settings.globalNote}
            {' '}
            <Popover title={t.settings.weightsHelpLink} trigger={<button type="button" className="link-btn">{t.settings.weightsHelpLink}</button>}>
              <div className="small">{t.settings.weightsHelp}</div>
            </Popover>
          </Box>
          {/* One under the other: side by side the 11–19 choice is cut off. */}
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
          {settings.rotation_mode === 'weekly' && (
            <Box tone="warn" title={t.settings.weeklyTitle}>
              {t.settings.weeklyBody}
            </Box>
          )}
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
          <SectionHeading as="h3" title={t.settings.swapPolicy} meta={t.settings.swapPolicyMeta} />
          <Checkbox
            name="coordinator_swap_approval_required"
            label={t.settings.swapApproval}
            hint={t.settings.swapApprovalHint}
            checked={settings.coordinator_swap_approval_required}
            disabled={policy.isLoading}
            onChange={(event) => setSettings({ ...settings, coordinator_swap_approval_required: event.target.checked })}
          />
        </form>
      </Panel>
      {result && (
        <Dialog
          open={publishConfirmOpen}
          onClose={closePublication}
          dismissible={!publish.isPending}
          size="lg"
          title={t.publish.title(!publishFromDraft, formatRange(result.starts_on, result.ends_on))}
          description={t.publish.effect(result.assignments.length, days)}
          actions={(
            <>
              {(preview || publishPreview.isFetching) && (
                <output className="dialog-foot-status">
                  {publishPreview.isFetching
                    ? t.publish.checking
                    : unresolvedConflicts + missingConsents > 0 ? t.publish.pending(unresolvedConflicts, missingConsents) : t.publish.ready}
                </output>
              )}
              <Button onClick={closePublication} disabled={publish.isPending}>{t.publish.back(publishFromDraft)}</Button>
              {/* Focusable while blocked, so the status beside it says what is missing. */}
              <Button
                variant="primary"
                loading={publish.isPending}
                aria-disabled={publishBlocked || undefined}
                onClick={() => {
                  if (publishBlocked) return
                  publish.mutate({
                    id: result.id,
                    expectedVersion: result.version,
                    acknowledgeLostChanges: Boolean(preview.lost_changes.length),
                    acknowledgeGap: Boolean(preview.uncovered_before.length),
                    acknowledgeRestViolations: Boolean(preview.rest_violations.length),
                    changeResolutions,
                  })
                }}
              >
                {publish.isPending ? t.publish.publishing : t.publish.publishNow}
              </Button>
            </>
          )}
        >
          {publish.error && (
            <Box tone="bad" role="alert" title={t.publish.failed}>
              {publish.error.message}
              <div className="box-next">{t.publish.failedNext(publishFromDraft)}</div>
            </Box>
          )}
          {publishPreview.error && <Box tone="bad" role="alert" title={t.publish.checkFailed} />}
          {preview && <PublicationEffects preview={preview} soft={counts.soft} />}
          {preview?.lost_changes.length ? (
            <Box tone="warn" title={t.publish.resolveConflicts(preview.lost_changes.length)}>
              <div className="stack-sm mt-6">
                {preview.lost_changes.map((change) => {
                  const key = `${change.service_date}:${change.role}`
                  const kind = t.publish.changeKind[change.source]
                  return (
                    <div key={key} className="stack-sm">
                      <div>
                        <b>{formatDayShort(change.service_date)} · {roleLabels()[change.role]}</b>
                        {' · '}{t.publish.lostChange(kind, change.previous_assignee_name, change.new_assignee_name)}
                        {change.reason && <div className="box-next">{change.reason}</div>}
                      </div>
                      <Field label={t.publish.decision} id={`resolution-${change.service_date}-${change.role}`}>
                        {({ id }) => (
                          <Select
                            id={id}
                            value={changeResolutions[key] ?? ''}
                            onChange={(event) => setChangeResolutions((current) => ({ ...current, [key]: event.target.value as 'draft' | 'change' }))}
                          >
                            <option value="">{t.publish.choose}</option>
                            <option value="change">{t.publish.keepChange[change.source](change.previous_assignee_name)}</option>
                            <option value="draft">{t.publish.keepDraft(change.new_assignee_name)}</option>
                          </Select>
                        )}
                      </Field>
                    </div>
                  )
                })}
              </div>
            </Box>
          ) : null}
          {[...restGroups].map(([rule, violations]) => (
            <AcknowledgeBox
              key={rule}
              title={t.publish.restTitle(violations[0].message)}
              label={t.publish.acknowledgeRest}
              checked={restAcknowledged.has(rule)}
              onChange={(checked) => setRestAcknowledged((current) => {
                const next = new Set(current)
                if (checked) next.add(rule)
                else next.delete(rule)
                return next
              })}
            >
              <ul className="box-list">
                {violations.map((violation) => (
                  <li key={`${violation.member_name}-${violation.days[0]}`}>{t.publish.restItem(violation.member_name, violation.days.map(formatDate).join(', '))}</li>
                ))}
              </ul>
            </AcknowledgeBox>
          ))}
          {preview?.uncovered_before.length ? (
            <AcknowledgeBox title={t.publish.gapTitle(preview.uncovered_before.map(formatDate).join(', '))} label={t.publish.acknowledgeGap} checked={gapAcknowledged} onChange={setGapAcknowledged} />
          ) : null}
          {result.starts_on <= today && (
            <Checkbox
              label={t.publish.acknowledge}
              checked={publishAcknowledged}
              onChange={(event) => setPublishAcknowledged(event.target.checked)}
            />
          )}
        </Dialog>
      )}
      <UnsavedChangesDialog guard={unsavedChanges} />
    </div>
  )
}
