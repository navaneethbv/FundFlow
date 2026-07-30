"use client";
import React from 'react';
import { XCircle, CheckCircle } from '@/components/ui/icons';

interface ReviewBannerProps {
  streamId: string;
  streamName: string;
  onReview: () => void;
  onDismiss: () => void;
}

export default function ReviewBanner({ streamId, streamName, onReview, onDismiss }: ReviewBannerProps) {
  return (
    <div className="mb-4 flex items-center justify-between rounded-lg bg-amber-100 p-4 shadow-md">
      <div className="flex items-center space-x-2">
        <XCircle className="h-6 w-6 text-amber-600" />
        <span className="text-sm text-amber-800">
          Review recurring charge <strong>{streamName}</strong>?
        </span>
      </div>
      <div className="flex space-x-2">
        <button
          onClick={onReview}
          className="rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Review
        </button>
        <button
          onClick={onDismiss}
          className="rounded bg-gray-300 px-3 py-1 text-sm font-medium text-gray-800 hover:bg-gray-200"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

