'use client';

import type { Report as ReportType } from '@/lib/providers';

interface ReportPanelProps {
  report: ReportType;
}

export default function ReportPanel({ report }: ReportPanelProps) {
  return (
    <div className="flex-1 overflow-y-auto p-6 border-r">
      <h2 className="text-2xl font-bold mb-6">{report.title}</h2>

      {report.knowledgePoints.length > 0 && (
        <div className="bg-white rounded-lg border p-6 mb-4">
          <h3 className="font-semibold mb-3 text-blue-600">核心知识点</h3>
          <ul className="list-disc list-inside space-y-1 text-sm">
            {report.knowledgePoints.map((kp, i) => (
              <li key={i}>{kp}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white rounded-lg border p-6 mb-4">
        <h3 className="font-semibold mb-3">话题概述与主要内容</h3>
        <p className="text-sm leading-relaxed">{report.content}</p>
      </div>

      {report.viewpoints.length > 0 && (
        <div className="bg-white rounded-lg border p-6 mb-4">
          <h3 className="font-semibold mb-3">主要观点与争议</h3>
          <ul className="list-disc list-inside space-y-1 text-sm">
            {report.viewpoints.map((vp, i) => (
              <li key={i}>{vp}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
