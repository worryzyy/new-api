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
import { ImagePlus, X } from 'lucide-react'
import { useId, useState, type ClipboardEvent } from 'react'
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { testModerationKeys } from '../../api'
import {
  buildConfigUpdate,
  splitLines,
  type ModerationFormValues,
} from '../../lib/config-form'
import { formatPercent } from '../../lib/display'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(reader.error))
    reader.readAsDataURL(file)
  })
}

export function ModerationTestPanel() {
  const { t } = useTranslation()
  const id = useId()
  const form = useFormContext<ModerationFormValues>()
  const [prompt, setPrompt] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const test = useMutation({
    mutationFn: () => {
      const values = form.getValues()
      const keys = splitLines(values.new_api_keys)
      return testModerationKeys({
        api_keys: keys.length > 0 ? keys.slice(0, 1) : undefined,
        base_url: values.base_url,
        model: values.model,
        timeout_ms: values.timeout_ms,
        thresholds: buildConfigUpdate(values).thresholds,
        prompt,
        images: image ? [image] : undefined,
      })
    },
    onError: (error) => handleServerError(error, t('Moderation test failed')),
  })

  const acceptImage = async (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error(t('Image must be 8 MB or smaller'))
      return
    }
    setImage(await readImage(file))
  }
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const file = [...event.clipboardData.files].find((item) =>
      item.type.startsWith('image/')
    )
    if (file) {
      event.preventDefault()
      void acceptImage(file)
    }
  }
  const verdict = test.data?.audit_result

  return (
    <div className='flex flex-col gap-3 border-t pt-4'>
      <Label htmlFor={`${id}-prompt`}>{t('Moderation test')}</Label>
      <Textarea
        id={`${id}-prompt`}
        rows={3}
        value={prompt}
        placeholder={t('Enter sample text; paste or upload one image')}
        onChange={(event) => setPrompt(event.target.value)}
        onPaste={onPaste}
      />
      <div className='flex flex-wrap items-center gap-2'>
        <Button
          type='button'
          size='sm'
          variant='outline'
          render={<label htmlFor={`${id}-image`} />}
        >
          <ImagePlus data-icon='inline-start' aria-hidden='true' />
          {t('Upload image')}
        </Button>
        <input
          id={`${id}-image`}
          type='file'
          accept='image/*'
          className='sr-only'
          onChange={(event) => void acceptImage(event.target.files?.[0])}
        />
        {image && (
          <span className='relative'>
            <img
              src={image}
              alt={t('Test image')}
              className='h-10 w-10 rounded object-cover'
            />
            <button
              type='button'
              className='bg-background absolute -top-1.5 -right-1.5 rounded-full border'
              aria-label={t('Remove image')}
              onClick={() => setImage(null)}
            >
              <X className='size-3' aria-hidden='true' />
            </button>
          </span>
        )}
        <Button
          type='button'
          size='sm'
          disabled={(!prompt.trim() && !image) || test.isPending}
          onClick={() => test.mutate()}
        >
          {test.isPending ? t('Testing...') : t('Run test')}
        </Button>
      </div>
      {test.isSuccess && !verdict && (
        <p role='status' className='text-warning text-sm'>
          {t(
            'No key returned a moderation result. Check the key health above.'
          )}
        </p>
      )}
      {verdict && (
        <div
          role='status'
          className='flex flex-col gap-2 rounded-lg border p-3'
        >
          <div className='flex flex-wrap items-center gap-2 text-sm'>
            <StatusBadge
              label={verdict.flagged ? t('Hit') : t('Passed')}
              variant={verdict.flagged ? 'danger' : 'success'}
              copyable={false}
            />
            {verdict.highest_category && (
              <span className='text-muted-foreground'>
                {t('Highest: {{category}} {{score}}', {
                  category: verdict.highest_category,
                  score: formatPercent(verdict.highest_score),
                })}
              </span>
            )}
          </div>
          {Object.entries(verdict.category_scores ?? {})
            .sort((a, b) => b[1] - a[1])
            .map(([category, score]) => {
              const threshold = verdict.thresholds?.[category]
              return (
                <div key={category} className='text-xs'>
                  <div className='flex justify-between'>
                    <span className='font-mono'>{category}</span>
                    <span className='tabular-nums'>
                      {formatPercent(score)}
                      {threshold !== undefined &&
                        ` / ${formatPercent(threshold)}`}
                    </span>
                  </div>
                  <Progress value={score * 100} aria-label={category} />
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}
