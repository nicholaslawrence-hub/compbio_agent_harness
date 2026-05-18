import UploadForm from '../components/UploadForm.jsx'

export default function RunPage() {
  return (
    <div className="py-3 w-[90%] max-w-5xl mx-auto">
      <div className="mb-3 pb-2 border-b border-slate-800">
        <h1 className="text-base font-semibold text-white tracking-tight">Run Analysis</h1>
        <p className="text-xs text-slate-500 mt-0.5">Submit RNA-seq counts to launch the agent pipeline.</p>
      </div>
      <UploadForm />
    </div>
  )
}
