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
import { cn } from '@/lib/utils'

export type MetricTone =
  | 'info'
  | 'neutral'
  | 'success'
  | 'destructive'
  | 'warning'
  | 'primary'

const TONE_CLASSES: Record<MetricTone, { box: string; value: string }> = {
  info: { box: 'bg-info/10', value: 'text-info' },
  neutral: { box: 'bg-muted/60', value: 'text-foreground' },
  success: { box: 'bg-success/10', value: 'text-success' },
  destructive: { box: 'bg-destructive/10', value: 'text-destructive' },
  warning: { box: 'bg-warning/10', value: 'text-warning' },
  primary: { box: 'bg-primary/10', value: 'text-primary' },
}

export function MetricTile(props: {
  label: string
  value: string | number
  hint?: string
  tone: MetricTone
}) {
  const tone = TONE_CLASSES[props.tone]
  return (
    <div className={cn('min-w-0 rounded-lg px-3 py-2.5', tone.box)}>
      <div className='text-muted-foreground truncate text-xs'>
        {props.label}
      </div>
      <div
        className={cn(
          'mt-1 truncate text-xl font-semibold tabular-nums',
          tone.value
        )}
      >
        {props.value}
      </div>
      {props.hint && (
        <div className='text-muted-foreground mt-0.5 truncate text-[11px]'>
          {props.hint}
        </div>
      )}
    </div>
  )
}
