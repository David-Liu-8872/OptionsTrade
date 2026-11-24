import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

interface EChartBoxProps {
  option: echarts.EChartsCoreOption;
  height?: string;
  className?: string;
  onItemClick?: (params: unknown) => void;
}

export function EChartBox({
  option,
  height = '320px',
  className = '',
  onItemClick,
}: EChartBoxProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);
  const clickHandlerRef = useRef(onItemClick);
  clickHandlerRef.current = onItemClick;

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current, undefined, {
      renderer: 'canvas',
    });
    instanceRef.current = chart;

    chart.on('click', (params) => {
      clickHandlerRef.current?.(params);
    });

    const ro = new ResizeObserver(() => {
      chart.resize();
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.dispose();
      instanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!instanceRef.current) return;
    if (!option || Object.keys(option).length === 0) return;
    try {
      instanceRef.current.setOption(option, { notMerge: true });
    } catch (err) {
      console.error('ECharts setOption error:', err);
    }
  }, [option]);

  return (
    <div
      ref={containerRef}
      style={{ height, width: '100%' }}
      className={className}
    />
  );
}
