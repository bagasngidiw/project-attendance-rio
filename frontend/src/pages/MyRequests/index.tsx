import { RequestHistoryList } from "@/features/requests/RequestHistoryList";

export default function MyRequests() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Permintaan Saya</h2>
        <p className="text-sm text-slate-500">
          Semua permintaan cuti, lembur, perjalanan dinas, ijin, dan sakit Anda
          dalam satu tempat.
        </p>
      </div>
      <RequestHistoryList />
    </div>
  );
}
