/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useMutation } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { testJudge } from '../../api'
import { splitLines, type ModerationFormValues } from '../../lib/config-form'
import { formatPercent } from '../../lib/display'

/** Runs the judge on a sample with the unsaved form values. */
export function JudgeTestPanel() {
  const { t } = useTranslation()
  const id = useId()
  const form = useFormContext<ModerationFormValues>()
  const [prompt, setPrompt] = useState('')
  const test = useMutation({
    mutationFn: () => {
      const values = form.getValues()
      const keys = splitLines(values.judge_new_api_keys)
      return testJudge({
        api_keys: keys.length > 0 ? keys.slice(0, 1) : undefined,
        base_url: values.judge_base_url,
        model: values.judge_model,
        timeout_ms: values.judge_timeout_ms,
        rules: values.judge_rules,
        threshold: values.judge_threshold / 100,
        prompt,
      })
    },
    onError: (error) => handleServerError(error, t('Moderation test failed')),
  })
  const result = test.data

  return (
    <div className='flex flex-col gap-3 border-t pt-4'>
      <Label htmlFor={`${id}-prompt`}>{t('Judge test')}</Label>
      <Textarea
        id={`${id}-prompt`}
        rows={3}
        value={prompt}
        placeholder={t(
          'Enter a sample message to see the verdict with the current form values'
        )}
        onChange={(event) => setPrompt(event.target.value)}
      />
      <div>
        <Button
          type='button'
          size='sm'
          disabled={!prompt.trim() || test.isPending}
          onClick={() => test.mutate()}
        >
          {test.isPending ? t('Testing...') : t('Run test')}
        </Button>
      </div>
      {result?.error && (
        <p role='status' className='text-destructive text-sm break-words'>
          {result.error}
        </p>
      )}
      {result?.verdict && (
        <div
          role='status'
          className='flex flex-col gap-1 rounded-lg border p-3 text-sm'
        >
          <div className='flex flex-wrap items-center gap-2'>
            <StatusBadge
              label={result.flagged ? t('Hit') : t('Passed')}
              variant={result.flagged ? 'danger' : 'success'}
              copyable={false}
            />
            {result.verdict.category && (
              <span className='font-medium'>{result.verdict.category}</span>
            )}
            <span className='text-muted-foreground tabular-nums'>
              {t('Confidence {{value}}', {
                value: formatPercent(result.verdict.confidence),
              })}
              {' · '}
              {result.latency_ms} ms
            </span>
          </div>
          {result.verdict.reason && (
            <p className='text-muted-foreground break-words'>
              {result.verdict.reason}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
