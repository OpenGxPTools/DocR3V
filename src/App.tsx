import { useCallback, useState } from 'react'
import { ComparisonView } from './components/ComparisonView.tsx'
import { Upload, type Selection } from './components/Upload.tsx'
import { diffDocuments } from './services/diffEngine.ts'
import { parseFile } from './services/documentParser.ts'
import type { DocumentDiff } from './types/diff.ts'

type Stage =
  | { name: 'idle' }
  | { name: 'working'; step: string }
  | { name: 'done'; diff: DocumentDiff }

export default function App() {
  const [stage, setStage] = useState<Stage>({ name: 'idle' })
  const [error, setError] = useState<unknown>()

  const compare = useCallback(async ({ original, revised }: Selection) => {
    setError(undefined)
    setStage({ name: 'working', step: 'Reading the documents…' })

    try {
      // Yielding to the browser between steps keeps the progress text honest;
      // parsing and diffing are synchronous once they start.
      const [parsedOriginal, parsedRevised] = await Promise.all([
        parseFile(original),
        parseFile(revised),
      ])

      setStage({ name: 'working', step: 'Comparing word by word…' })
      await new Promise((resolve) => setTimeout(resolve, 0))

      setStage({ name: 'done', diff: diffDocuments(parsedOriginal, parsedRevised) })
    } catch (problem) {
      setError(problem)
      setStage({ name: 'idle' })
    }
  }, [])

  if (stage.name === 'done') {
    return <ComparisonView diff={stage.diff} onReset={() => setStage({ name: 'idle' })} />
  }

  return (
    <>
      <Upload
        onCompare={compare}
        busy={stage.name === 'working'}
        error={error}
        onClearError={() => setError(undefined)}
      />
      {stage.name === 'working' && (
        <p role="status" className="px-6 pb-8 text-center text-sm text-note">
          {stage.step}
        </p>
      )}
    </>
  )
}
