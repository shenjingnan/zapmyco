import React from 'react';
import { Slider } from "@/components/ui/slider";

const IOSStyleSlider = () => {
  return (
    <div className="bg-gray-100 dark:bg-gray-800 p-6 rounded-xl">
      <div className="relative">
        {/* 滑块容器 */}
        <div className="relative h-12 flex items-center">
          <Slider
            defaultValue={[75]}
            max={100}
            step={1}
            className="absolute inset-0"
            // 自定义滑块样式
            style={{
              track: {
                background: 'linear-gradient(to right, #fff 0%, #fff 100%)',
                height: '48px',
                borderRadius: '24px',
              },
              thumb: {
                width: '48px',
                height: '48px',
                backgroundColor: '#fff',
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                border: '1px solid rgba(0,0,0,0.1)',
              },
              rail: {
                background: 'rgba(120,120,128,0.16)',
                height: '48px',
                borderRadius: '24px',
              }
            }}
          />
          {/* 太阳图标 */}
          <div className="absolute left-4 top-1/2 transform -translate-y-1/2 pointer-events-none">
            <svg 
              width="24" 
              height="24" 
              viewBox="0 0 24 24" 
              fill="none" 
              className="text-gray-600"
            >
              <path 
                d="M12 17C14.7614 17 17 14.7614 17 12C17 9.23858 14.7614 7 12 7C9.23858 7 7 9.23858 7 12C7 14.7614 9.23858 17 12 17Z" 
                stroke="currentColor" 
                strokeWidth="2"
              />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IOSStyleSlider;