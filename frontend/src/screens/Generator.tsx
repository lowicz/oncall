import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
  Step,
  StepLabel,
  Stepper,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import ExpandMore from '@mui/icons-material/ExpandMore'
import {
  DraftSchedule, LateShiftAnchor, RotationMode, ScheduleRun, ScheduleSummary, ScheduleWarning, api,
} from '../api'
import { lateShiftAnchorLabels, roleLabels, rotationLabels, scheduleStatusLabels } from '../lib/labels'
import { addDays, formatDate, warsawDate } from '../lib/dates'
import { DraftScheduleMatrix } from '../components/DraftScheduleMatrix'
import { DraftFairnessPanel } from '../components/DraftFairnessPanel'
import { DraftList } from '../components/DraftList'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DateField } from '../components/DateField'
import { ScheduleComparison } from '../components/ScheduleComparison'

/** CP-SAT statuses that mean the model was actually solved. */
const SOLVER_OK = ['OPTIMAL', 'FEASIBLE']

/** Two sources of warnings, kept apart: the solver gave something up, or the
 *  schedule as it stands breaks a hard rule. Both used to arrive as bare
 *  strings opening with „Korekta", even where nobody had corrected anything. */
const WARNING_TITLES: Record<ScheduleWarning['source'], string> = {
  solver: 'Ostrzeżenie solvera',
  rules: 'Złamana reguła twarda',
}

/** Why „Przekaż do akceptacji" is off: the API would answer 409 anyway. */
const PROPOSE_BLOCKED = 'Najpierw usuń dyżury w dniach zgłoszonej niedostępności'

/** Mirrors `scheduler.GENERATION_BUDGET_PASSES`: one generation runs this many
 *  solver passes at most, so the whole-run ceiling is the per-pass budget times
 *  this. The backend sends `time_budget_seconds`; this is only for the live
 *  preview while the coordinator is still typing an unsaved budget. */
const GENERATION_BUDGET_PASSES = 4

/** Polish count of generations ahead in the queue. */
function jobsAhead(count: number): string {
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
  useEffect(() => {
    if (suggestedRange.data && !hasLinkedRange) {
      setRange({
        starts_on: suggestedRange.data.starts_on,
        ends_on: suggestedRange.data.ends_on,
      })
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
  const opened = useQuery({
    queryKey: ['schedule', openId],
    queryFn: () => api.schedule(openId!),
    enabled: Boolean(openId),
  })
  useEffect(() => {
    if (opened.data) setResult(opened.data)
  }, [opened.data])
  // Hard unavailability the draft was generated before, or that arrived after.
  // The backend rejects propose and publish over it, so the screen must neither
  // claim the draft satisfies every hard rule nor offer the button (HGH5-02).
  const conflictCount = result?.unavailability_conflicts?.length ?? 0
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false)
  const [changeResolutions, setChangeResolutions] = useState<
    Record<string, 'draft' | 'change'>
  >({})
  const publishPreview = useQuery({
    queryKey: ['publish-preview', result?.id, result?.version],
    queryFn: () => api.publishPreview(result!.id),
    enabled: publishConfirmOpen && result?.status === 'proposed',
  })
  useEffect(() => setChangeResolutions({}), [result?.id, result?.version])
  const [toDelete, setToDelete] = useState<ScheduleSummary | null>(null)
  const remove = useMutation({
    mutationFn: api.deleteSchedule,
    onSuccess: (_data, id) => {
      setToDelete(null)
      // Close the view if the deleted draft was the one open.
      if (openId === id) {
        setOpenId(null)
        setResult(null)
      }
      invalidateDrafts()
    },
  })
  // Rotation mode and the 11-19 anchor are stored policy, not request parameters:
  // api.generateSchedule sends only the date range and the solver reads them from
  // the saved policy. They therefore live here as a draft of the settings and are
  // written only on an explicit save, never on change.
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
  const settingsDirty = Boolean(
    policy.data
    && (settings.rotation_mode !== policy.data.rotation_mode
      || settings.late_shift_anchor !== policy.data.late_shift_anchor
      || settings.fairness_weight !== policy.data.fairness_weight
      || settings.continuity_weight !== policy.data.continuity_weight
      || settings.preference_weight !== policy.data.preference_weight
      || settings.solve_seconds !== policy.data.solve_seconds),
  )
  const invalidateDrafts = () => {
    queryClient.invalidateQueries({ queryKey: ['active-runs'] })
    queryClient.invalidateQueries({ queryKey: ['draft-schedules'] })
    // Without this the ['schedule', id] entry keeps the pre-transition payload
    // for the global 30s staleTime and the effect below would rewind `result`.
    queryClient.invalidateQueries({ queryKey: ['schedule'] })
  }
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
  const propose = useMutation({
    mutationFn: api.proposeSchedule,
    onSuccess: (value) => {
      setResult(value)
      invalidateDrafts()
    },
  })
  const withdraw = useMutation({
    mutationFn: api.withdrawSchedule,
    onSuccess: (value) => {
      setResult(value)
      invalidateDrafts()
    },
  })
  const publish = useMutation({
    mutationFn: api.publishSchedule,
    onSuccess: (value) => {
      setResult(value)
      setPublishConfirmOpen(false)
      queryClient.invalidateQueries({ queryKey: ['published-schedule'] })
      invalidateDrafts()
    },
  })

  return (
    <Box className="generator-section" id="generator">
      <Box>
        <Typography className="eyebrow">[GENERATOR SZKICU]</Typography>
        <Typography variant="h1">Generator grafiku</Typography>
        <Typography color="text.secondary">
          Wynik jest szkicem. Nie zastępuje opublikowanego grafiku.
        </Typography>
      </Box>
      <DraftList
        activeId={result?.id}
        onOpen={setOpenId}
        onDelete={setToDelete}
        deleting={remove.isPending}
      />
      <ScheduleComparison drafts={drafts.data ?? []} />
      {opened.isLoading && <CircularProgress size={24} aria-label="Otwieranie szkicu" />}
      {opened.error && <Alert severity="error">{opened.error.message}</Alert>}
      <Typography variant="h2">Nowy szkic</Typography>
      <Paper
        component="form"
        variant="outlined"
        className="form-row generator-form"
        onSubmit={(event) => { event.preventDefault(); generate.mutate(range) }}
      >
        <DateField
          id="generator-from"
          label="Od"
          value={range.starts_on}
          onChange={(value) => setRange({ ...range, starts_on: value })}
          required
        />
        <DateField
          id="generator-to"
          label="Do"
          value={range.ends_on}
          onChange={(value) => setRange({ ...range, ends_on: value })}
          required
        />
        <Button type="submit" variant="contained" disabled={generating}>
          {generating
            ? runProgress?.status === 'queued' ? 'W kolejce…' : 'Generuję…'
            : 'Utwórz szkic'}
        </Button>
        <Typography color="text.secondary" className="generator-active-policy">
          Zapisane ustawienia: {rotationLabels[policy.data?.rotation_mode ?? 'hybrid']}
          {' · 11–19: '}
          {lateShiftAnchorLabels[policy.data?.late_shift_anchor ?? 'secondary']}
          {settingsDirty && ' · masz niezapisane zmiany poniżej'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Jedno generowanie może obejmować maksymalnie 35 dni. Dłuższy okres podziel
          na kolejne, zachodzące po sobie szkice.
        </Typography>
        {/* A one-day range is accepted by the API, but there is nothing to
            balance across one day, so the result is a coverage fill rather than
            a schedule (LOW5-15). */}
        {range.starts_on === range.ends_on && range.starts_on !== '' && (
          <Alert severity="warning">
            Zakres obejmuje jeden dzień. Bilansowanie na jednym dniu nie ma sensu:
            solver tylko obsadzi ten dzień, nie wyrówna niczyjego udziału.
          </Alert>
        )}
      </Paper>
      {generating && (
        <Box aria-live="polite">
          {Boolean(runProgress?.uncovered_before?.length) && (
            <Alert severity="warning" sx={{ mb: 1 }}>
              Przed początkiem szkicu pozostaje {runProgress!.uncovered_before!.length} {' '}
              nieobsadzonych dni: {runProgress!.uncovered_before!.map(formatDate).join(', ')}.
            </Alert>
          )}
          <LinearProgress variant="determinate" value={runProgress?.progress ?? 0} />
          <Typography color="text.secondary">
            {runProgress?.status === 'queued'
              ? queueSentence(runProgress)
              : 'Solver pracuje poza procesem API. Możesz korzystać z pozostałych ekranów.'}
          </Typography>
          {/* The budget is per solver pass, and a model that has to prove the
              acceptance criterion unattainable is solved several times over -
              measured at roughly 25 s against a 15 s budget. Saying „budżet do
              15 s" next to a counter reading 30 would look like a defect, so
              the per-pass meaning is spelled out. Outside the live region: the
              counter changes every second and would be re-announced that
              often, drowning out the status sentence next to it. */}
          {runProgress?.solve_seconds !== undefined && (
            <Typography color="text.secondary" aria-live="off">
              {elapsed} s · budżet {Math.round(runProgress.solve_seconds)} s na jeden
              przebieg solvera, trudny grafik wymaga kilku
              {policy.data?.time_budget_seconds !== undefined
                && `, łącznie do ${Math.round(policy.data.time_budget_seconds)} s`}
              .
            </Typography>
          )}
          {resume.isPending && (
            <Typography color="text.secondary">
              Wznowiono podgląd generowania rozpoczętego wcześniej - nie uruchamiaj go drugi raz.
            </Typography>
          )}
        </Box>
      )}
      <Accordion variant="outlined" disableGutters className="generator-settings">
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography variant="h2">
            Ustawienia generowania{settingsDirty ? ' · niezapisane zmiany' : ''}
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
      <Paper
        component="form"
        variant="outlined"
        className="form-row generator-form weights-form"
        onSubmit={(event) => {
          event.preventDefault()
          savePolicy.mutate(settings)
        }}
      >
        <Alert severity="info" className="weights-explainer">
          Te ustawienia są zapisywane globalnie dla całego zespołu i obowiązują od
          następnego generowania. Wagi zmieniają względny priorytet reguł miękkich. Nie
          mogą wyłączyć eligibility, niedostępności ani wymaganego pokrycia. Znaczenie ma
          wyłącznie relacja między wagami, nie ich wartości bezwzględne: 6 / 4 / 2 działa
          tak samo jak 3 / 2 / 1. Wartość 0 wyłącza wskazany człon celu w całości - także
          „Równy udział”, który preferencją nie jest.
        </Alert>
        <TextField
          select
          id="policy-rotation-mode"
          name="rotation_mode"
          label="Tryb rotacji"
          value={settings.rotation_mode}
          disabled={policy.isLoading}
          onChange={(event) =>
            setSettings({ ...settings, rotation_mode: event.target.value as RotationMode })
          }
          helperText="Bazowy blok rotacji. Każda doba i tak pozostaje osobnym przydziałem."
        >
          {Object.entries(rotationLabels).map(([value, label]) => (
            <MenuItem key={value} value={value}>{label}</MenuItem>
          ))}
        </TextField>
        {settings.rotation_mode === 'weekly' && (
          <Alert severity="warning" className="weights-explainer">
            Tryb tygodniowy wyłącza limit 3 dyżurów w 7 dniach i dwudniowy odpoczynek
            po serii - inaczej tydzień u jednej osoby byłby nie do obsadzenia. Zmierzone
            skutki: serie 12-dniowe i 31 okien z ponad 3 dyżurami.
          </Alert>
        )}
        <TextField
          select
          id="policy-late-shift-anchor"
          name="late_shift_anchor"
          label="Powiązanie 11–19"
          value={settings.late_shift_anchor}
          disabled={policy.isLoading}
          onChange={(event) => setSettings({
            ...settings,
            late_shift_anchor: event.target.value as LateShiftAnchor,
          })}
          helperText="Reguła twarda dla osób eligible do obu ról; pozostałe wyjątki są raportowane."
        >
          {Object.entries(lateShiftAnchorLabels).map(([value, label]) => (
            <MenuItem key={value} value={value}>{label}</MenuItem>
          ))}
        </TextField>
        <TextField
          type="number"
          id="policy-fairness-weight"
          name="fairness_weight"
          label="Równy udział"
          value={settings.fairness_weight}
          onChange={(event) =>
            setSettings({ ...settings, fairness_weight: Number(event.target.value) })
          }
          slotProps={{ htmlInput: { min: 0, max: 100, step: 0.5 } }}
          helperText={'Najwyższy domyślny priorytet: wyrównuje cały rozkład i mocniej karze '
            + 'wartości odstające. Podniesienie jej odbierze dyżur osobie, która ma ich '
            + 'najwięcej, nawet jeśli akurat wolałaby go wziąć.'}
        />
        <TextField
          type="number"
          id="policy-preference-weight"
          name="preference_weight"
          label="Preferencje zespołu"
          value={settings.preference_weight}
          onChange={(event) =>
            setSettings({ ...settings, preference_weight: Number(event.target.value) })
          }
          slotProps={{ htmlInput: { min: 0, max: 100, step: 0.5 } }}
          helperText={'Środkowy domyślny priorytet: respektuje „wolę nie” i „chętnie wezmę”. '
            + 'Podniesienie jej częściej obsadzi weekend osobą, która się o niego zgłosiła, '
            + 'kosztem równego udziału.'}
        />
        <TextField
          type="number"
          id="policy-continuity-weight"
          name="continuity_weight"
          label="Ciągłość rotacji"
          value={settings.continuity_weight}
          onChange={(event) =>
            setSettings({ ...settings, continuity_weight: Number(event.target.value) })
          }
          slotProps={{ htmlInput: { min: 0, max: 100, step: 0.5 } }}
          helperText={'Najniższy domyślny priorytet: ogranicza przekazania w obrębie tygodnia. '
            + 'Podniesienie jej wydłuży serie u jednej osoby zamiast rozdzielać tydzień '
            + 'między kilka osób.'}
        />
        <TextField
          type="number"
          id="policy-solve-seconds"
          name="solve_seconds"
          label="Budżet czasu na przebieg solvera (s)"
          value={settings.solve_seconds}
          onChange={(event) =>
            setSettings({ ...settings, solve_seconds: Number(event.target.value) })
          }
          slotProps={{ htmlInput: { min: 5, max: 300, step: 5 } }}
          helperText={'Ile sekund solver ma na jeden przebieg (5-300). Jedno generowanie '
            + 'wykonuje ich kilka, więc górny limit całego generowania to około '
            + `${Math.round((settings.solve_seconds || 0) * GENERATION_BUDGET_PASSES)} s. `
            + 'Komunikat „solver nie zdążył” odsyła właśnie tutaj. Dłuższy budżet nie '
            + 'poprawia już rozpiętości powyżej wartości domyślnej - podnoś go dla '
            + 'dłuższych zakresów.'}
        />
        <Alert severity="info" className="weights-explainer">
          Weekendy i bloki świąteczne są regułą twardą: solver zawsze przydziela
          cały blok jednej osobie w danej roli. Podział bloku jest możliwy tylko
          ręcznie, przez korektę koordynatora albo zamianę po publikacji.
        </Alert>
        <Button
          type="submit"
          variant={settingsDirty ? 'contained' : 'text'}
          disabled={savePolicy.isPending || policy.isLoading || !settingsDirty}
        >
          {savePolicy.isPending ? 'Zapisuję…' : 'Zapisz ustawienia generowania'}
        </Button>
      </Paper>
        </AccordionDetails>
      </Accordion>
      {(policy.error || savePolicy.error || generate.error || resume.error || propose.error
        || publish.error || remove.error) && (
        <Alert severity="error">
          {policy.error?.message ?? savePolicy.error?.message
            ?? generate.error?.message ?? resume.error?.message ?? propose.error?.message
            ?? publish.error?.message ?? remove.error?.message}
          {(generate.error || resume.error)
            && runProgress?.conflicts && runProgress.conflicts.length > 0 && (
            <Box component="ul" sx={{ mb: 0, mt: 1, pl: 3 }}>
              {runProgress.conflicts.map((conflict) => <li key={conflict}>{conflict}</li>)}
            </Box>
          )}
        </Alert>
      )}
      <ConfirmDialog
        open={Boolean(toDelete)}
        pending={remove.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        title="Usunąć szkic?"
        confirmLabel="Usuń"
        confirmColor="error"
        description={toDelete && (
          <>
            {toDelete.name} ({formatDate(toDelete.starts_on)} - {formatDate(toDelete.ends_on)}).
            {' '}Tej operacji nie da się cofnąć.
          </>
        )}
      />
      {result && (
        <Paper variant="outlined" className="draft-result">
          {(result.warnings ?? []).map((warning) => (
            <Alert severity="warning" key={`${warning.source}:${warning.message}`}>
              <AlertTitle>{WARNING_TITLES[warning.source]}</AlertTitle>
              {warning.message}
            </Alert>
          ))}
          {Boolean(result.uncovered_before?.length) && (
            <Alert severity="warning">
              Przed początkiem szkicu pozostaje {result.uncovered_before!.length} nieobsadzonych
              {result.uncovered_before!.length === 1 ? ' dzień' : ' dni'}: {' '}
              {result.uncovered_before!.map(formatDate).join(', ')}.
            </Alert>
          )}
          {Boolean(result.stale_changes_count) && (
            <Alert severity="warning">
              Szkic nieaktualny: od wygenerowania zmieniło się {result.stale_changes_count} wpisów.
            </Alert>
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2}>
            <Box>
              <Typography className="role-label">
                [{scheduleStatusLabels[result.status].toUpperCase()}] · {rotationLabels[result.rotation_mode]}
              </Typography>
              <Typography variant="h2">{result.name}</Typography>
              <Typography color="text.secondary">Wersja {result.version}</Typography>
            </Box>
            <Stack direction="row" gap={1} alignItems="flex-start">
              <Chip
                label={`CP-SAT: ${result.solver_status}`}
                color={
                  result.solver_status === 'OPTIMAL' ? 'success'
                    : result.solver_status === 'FEASIBLE' ? 'info'
                      : 'warning'
                }
              />
              <Chip label={`${result.assignments.length} przydziałów`} />
            </Stack>
          </Stack>
          {result.solver_status === 'FEASIBLE' && conflictCount === 0 && (
            <Alert severity="info">
              Sprawiedliwość: {result.fairness_proven
                ? 'optymalna (udowodniona)'
                : 'najlepsza znaleziona'}. Jakość całego rozwiązania: {result.continuity_gap == null
                ? 'bez oszacowania luki'
                : `luka ${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 }).format(result.continuity_gap * 100)}%`}.
              {' '}Stan kryterium pokazuje panel poniżej.
            </Alert>
          )}
          {!SOLVER_OK.includes(result.solver_status) && (
            <Alert severity="warning">
              Solver nie znalazł pełnego rozwiązania (status {result.solver_status}).
              Najczęstsze przyczyny to zbyt mało osób z eligibility na daną rolę,
              nakładające się niedostępności albo zbyt krótki zakres. Sprawdź luki
              w macierzy poniżej i popraw je ręcznie albo zawęź zakres.
            </Alert>
          )}
          {/* Who acts at which stage: two unlabelled buttons did not say. */}
          <Stepper activeStep={STAGES.indexOf(result.status)} className="draft-stepper">
            {STAGES.map((stage) => (
              <Step key={stage}>
                <StepLabel optional={<Typography variant="caption">{STAGE_ACTORS[stage]}</Typography>}>
                  {scheduleStatusLabels[stage]}
                </StepLabel>
              </Step>
            ))}
          </Stepper>
          <DraftScheduleMatrix result={result} onChange={setResult} />
          <DraftFairnessPanel result={result} />
          <Stack direction="row" gap={1} justifyContent="flex-end">
            {result.status === 'draft' && (
              <Tooltip title={conflictCount > 0 ? PROPOSE_BLOCKED : ''}>
                <span>
                  <Button
                    variant="outlined"
                    disabled={propose.isPending || conflictCount > 0}
                    onClick={() => propose.mutate({
                      id: result.id,
                      expectedVersion: result.version,
                    })}
                  >Przekaż do akceptacji</Button>
                </span>
              </Tooltip>
            )}
            {result.status === 'proposed' && (
              <>
                <Button
                  variant="outlined"
                  disabled={withdraw.isPending}
                  onClick={() => withdraw.mutate({ id: result.id, expectedVersion: result.version })}
                >Wróć do szkicu</Button>
                <Button
                  variant="contained"
                  disabled={publish.isPending}
                  onClick={() => setPublishConfirmOpen(true)}
                >Opublikuj grafik</Button>
              </>
            )}
            {result.status === 'published' && <Alert severity="success">Grafik opublikowany.</Alert>}
          </Stack>
          {result.status === 'draft' && conflictCount > 0 && (
            <Typography color="error" textAlign="right">{PROPOSE_BLOCKED}</Typography>
          )}
          <Dialog
            open={publishConfirmOpen}
            onClose={() => !publish.isPending && setPublishConfirmOpen(false)}
            aria-labelledby="publish-dialog-title"
          >
            <DialogTitle id="publish-dialog-title">Opublikować grafik?</DialogTitle>
            <DialogContent>
              {result.starts_on <= today && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  Ten zakres obejmuje dzisiejszy albo wcześniejszy dzień. Publikacja może
                  natychmiast zmienić dyżur, który już trwa.
                </Alert>
              )}
              <Typography>
                Dni {formatDate(result.starts_on)} - {formatDate(result.ends_on)} będą
                rozstrzygane z tego grafiku ({new Set(result.assignments.map(
                  (item) => item.service_date,
                )).size} dni). Wcześniejszy grafik zachowuje ważność poza tym zakresem.
                Grafiki w całości pokryte nowym zakresem zostaną wycofane.
              </Typography>
              {publishPreview.isLoading && (
                <Stack direction="row" gap={1} alignItems="center" sx={{ mt: 2 }}>
                  <CircularProgress size={18} />
                  <Typography>Sprawdzam zmiany i oczekujące zamiany…</Typography>
                </Stack>
              )}
              {publishPreview.error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  Nie udało się sprawdzić skutków publikacji. Zamknij okno i spróbuj ponownie.
                </Alert>
              )}
              {publishPreview.data?.lost_changes.length ? (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  <AlertTitle>Rozstrzygnij konflikty ze zmianami</AlertTitle>
                  {publishPreview.data.lost_changes.map((change) => (
                    <Box key={`${change.service_date}-${change.role}`} sx={{ mt: 1 }}>
                      <Typography>
                        {formatDate(change.service_date)} · {roleLabels[change.role]}: zmiana {' '}
                        {change.previous_assignee_name}, szkic {change.new_assignee_name}.
                        {' '}{change.reason}
                      </Typography>
                      <TextField
                        select
                        size="small"
                        label="Decyzja"
                        value={changeResolutions[`${change.service_date}:${change.role}`] ?? ''}
                        onChange={(event) => setChangeResolutions((current) => ({
                          ...current,
                          [`${change.service_date}:${change.role}`]: event.target.value as 'draft' | 'change',
                        }))}
                        sx={{ mt: 1, minWidth: 240 }}
                      >
                        <MenuItem value="draft">Zachowaj przydział ze szkicu</MenuItem>
                        <MenuItem value="change">Zachowaj wcześniejszą zmianę</MenuItem>
                      </TextField>
                    </Box>
                  ))}
                </Alert>
              ) : null}
              {publishPreview.data?.carried_changes.length ? (
                <Alert severity="success" sx={{ mt: 2 }}>
                  <AlertTitle>Zmiany zostaną przeniesione</AlertTitle>
                  {publishPreview.data.carried_changes.map((change) => (
                    <Typography key={`${change.service_date}-${change.role}`} component="div">
                      {formatDate(change.service_date)} · {roleLabels[change.role]}: {' '}
                      {change.previous_assignee_name}
                    </Typography>
                  ))}
                </Alert>
              ) : null}
              {publishPreview.data?.pending_swaps.length ? (
                <Alert severity="info" sx={{ mt: 2 }}>
                  <AlertTitle>Te oczekujące zamiany zostaną anulowane</AlertTitle>
                  {publishPreview.data.pending_swaps.map((swap) => (
                    <Typography key={swap.id} component="div">
                      {formatDate(swap.service_date)} · {roleLabels[swap.role]}: {' '}
                      {swap.requester_name} → {swap.replacement_name}
                    </Typography>
                  ))}
                </Alert>
              ) : null}
              {publishPreview.data?.uncovered_before.length ? (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  <AlertTitle>Przed grafikiem pozostanie luka</AlertTitle>
                  Nieobsadzone dni: {publishPreview.data.uncovered_before.map(formatDate).join(', ')}.
                </Alert>
              ) : null}
              {publishPreview.data?.stale_changes_count ? (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  Szkic nieaktualny: od wygenerowania zmieniło się {' '}
                  {publishPreview.data.stale_changes_count} wpisów.
                </Alert>
              ) : null}
              {publishPreview.data?.rest_violations.length ? (
                <Alert severity="error" sx={{ mt: 2 }}>
                  <AlertTitle>Publikacja naruszy reguły odpoczynku</AlertTitle>
                  {publishPreview.data.rest_violations.map((violation) => (
                    <Typography key={`${violation.member_name}-${violation.rule}`} component="div">
                      {violation.member_name}: {violation.message} {' '}
                      {violation.days.map(formatDate).join(', ')}
                    </Typography>
                  ))}
                </Alert>
              ) : null}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPublishConfirmOpen(false)} disabled={publish.isPending}>
                Anuluj
              </Button>
              <Button
                variant="contained"
                disabled={
                  publish.isPending
                  || publishPreview.isLoading
                  || publishPreview.isError
                  || Boolean(publishPreview.data?.lost_changes.some(
                    (item) => !changeResolutions[`${item.service_date}:${item.role}`],
                  ))
                }
                onClick={() => publish.mutate({
                  id: result.id,
                  expectedVersion: result.version,
                  acknowledgeLostChanges: Boolean(publishPreview.data?.lost_changes.length),
                  acknowledgeGap: Boolean(publishPreview.data?.uncovered_before.length),
                  acknowledgeRestViolations: Boolean(publishPreview.data?.rest_violations.length),
                  changeResolutions,
                })}
              >{publish.isPending ? 'Publikuję…' : 'Tak, opublikuj'}</Button>
            </DialogActions>
          </Dialog>
        </Paper>
      )}
    </Box>
  )
}
