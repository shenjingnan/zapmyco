import React, { HTMLAttributes, forwardRef } from 'react';
import { cn } from '../../utils/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * 是否有边框
   */
  bordered?: boolean;
  /**
   * 是否有阴影
   */
  shadowed?: boolean;
  /**
   * 是否可点击（添加悬停效果）
   */
  clickable?: boolean;
  /**
   * 卡片内容
   */
  children?: React.ReactNode;
}

/**
 * 卡片组件
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    { className, bordered = true, shadowed = true, clickable = false, children, ...props },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-lg bg-white dark:bg-gray-800',
          bordered && 'border border-gray-200 dark:border-gray-700',
          shadowed && 'shadow-sm',
          clickable && 'cursor-pointer transition-shadow hover:shadow-md',
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';

/**
 * 卡片标题组件
 */
export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * 卡片标题内容
   */
  children?: React.ReactNode;
}

export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('px-4 py-3 border-b border-gray-200 dark:border-gray-700', className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

CardHeader.displayName = 'CardHeader';

/**
 * 卡片内容组件
 */
export interface CardContentProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * 卡片内容
   */
  children?: React.ReactNode;
}

export const CardContent = forwardRef<HTMLDivElement, CardContentProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div ref={ref} className={cn('p-4', className)} {...props}>
        {children}
      </div>
    );
  }
);

CardContent.displayName = 'CardContent';

/**
 * 卡片底部组件
 */
export interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * 卡片底部内容
   */
  children?: React.ReactNode;
}

export const CardFooter = forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('px-4 py-3 border-t border-gray-200 dark:border-gray-700', className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

CardFooter.displayName = 'CardFooter'; 