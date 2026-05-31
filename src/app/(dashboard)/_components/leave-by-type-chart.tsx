'use client'

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

interface Slice {
  value: number
  color: string
}

// Dynamically imported (ssr:false) so recharts stays out of the initial bundle.
export default function LeaveByTypeChart({ data, daysLabel }: { data: Slice[]; daysLabel: string }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value" strokeWidth={0}>
          {data.map((entry, index) => (
            <Cell key={index} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px', fontSize: '12px' }}
          formatter={(value) => [`${value} ${daysLabel}`, '']}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
