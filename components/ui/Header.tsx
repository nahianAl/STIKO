'use client';

import Link from 'next/link';
import Breadcrumbs from './Breadcrumbs';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface HeaderProps {
  breadcrumbs?: BreadcrumbItem[];
  rightContent?: React.ReactNode;
}

export default function Header({ breadcrumbs, rightContent }: HeaderProps) {
  return (
    <header className="bg-gray-900 text-white h-16 flex-shrink-0 sticky top-0 z-50">
      <div className="h-full px-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-xl font-bold tracking-tight hover:text-gray-200 transition-colors">
            Stiko
          </Link>
          {breadcrumbs && breadcrumbs.length > 0 && (
            <>
              <span className="text-gray-600">|</span>
              <Breadcrumbs items={breadcrumbs} />
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {rightContent}
        </div>
      </div>
    </header>
  );
}
