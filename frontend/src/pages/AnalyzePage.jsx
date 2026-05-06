import UploadForm from '../components/UploadForm.jsx'

export default function AnalyzePage() {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-slate-100 mb-1">New Analysis</h1>
        <p className="text-sm text-slate-500">
          Upload a gene expression count matrix to identify therapeutic targets.
        </p>
      </div>
      <UploadForm />
    </div>
  )
}
