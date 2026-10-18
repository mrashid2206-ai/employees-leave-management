import { ServiceWorkerRegistration } from '@/components/service-worker-registration'

export default function CheckInLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {/* Here rather than inside a tab, so the portal is installable from first load. */}
      <ServiceWorkerRegistration />
    </>
  )
}
