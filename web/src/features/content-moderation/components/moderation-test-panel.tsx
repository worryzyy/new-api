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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { SettingsSection } from '@/features/system-settings/components/settings-section'
import { handleServerError } from '@/lib/handle-server-error'

import { testModeration } from '../api'
import { moderationReason } from '../lib/display'

export function ModerationTestPanel() {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const mutation = useMutation({
    mutationFn: testModeration,
    onError: (error) => handleServerError(error, t('Moderation test failed')),
  })
  const verdict = mutation.data

  return (
    <SettingsSection title={t('Test saved settings')}>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Checks a sample text with the saved keywords and OpenAI settings. Nothing is recorded.'
        )}
      </p>
      <div className='flex flex-col gap-2'>
        <Label htmlFor='content-moderation-test-text'>{t('Sample text')}</Label>
        <Textarea
          id='content-moderation-test-text'
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <div className='flex flex-wrap items-center gap-3'>
        <Button
          type='button'
          variant='outline'
          disabled={!text.trim() || mutation.isPending}
          onClick={() => mutation.mutate(text)}
        >
          {mutation.isPending ? t('Testing...') : t('Run test')}
        </Button>
        {verdict && (
          <div
            role='status'
            className='flex flex-wrap items-center gap-2 text-sm'
          >
            <StatusBadge
              label={verdict.flagged ? t('Violation') : t('Passed')}
              variant={verdict.flagged ? 'danger' : 'success'}
              copyable={false}
            />
            {verdict.flagged && (
              <span className='text-muted-foreground'>
                {moderationReason(verdict, t)}
              </span>
            )}
          </div>
        )}
      </div>
    </SettingsSection>
  )
}
