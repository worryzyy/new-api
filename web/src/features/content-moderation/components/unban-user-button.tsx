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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { handleServerError } from '@/lib/handle-server-error'

import { unbanModerationUser, type ModerationLog } from '../api'

export function UnbanUserButton(props: { entry: ModerationLog }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const unban = useMutation({
    mutationFn: () => unbanModerationUser(props.entry.user_id),
    onSuccess: async () => {
      setOpen(false)
      toast.success(t('User unbanned'))
      await queryClient.invalidateQueries({
        queryKey: ['content-moderation', 'logs'],
      })
    },
    onError: (error) => handleServerError(error, t('Failed to unban user')),
  })

  return (
    <>
      <Button
        size='sm'
        variant='outline'
        className='h-6 px-2 text-xs'
        onClick={() => setOpen(true)}
      >
        {t('Unban')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('Unban user')}
        desc={t('Enable user {{name}} again?', {
          name:
            props.entry.user_email ||
            props.entry.username ||
            `#${props.entry.user_id}`,
        })}
        confirmText={t('Unban')}
        isLoading={unban.isPending}
        handleConfirm={() => unban.mutate()}
      />
    </>
  )
}
