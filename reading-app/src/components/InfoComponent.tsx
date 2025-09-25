import type { ParagraphViewModel } from "../analysis/viewModels/mapParagraphToVM";
import type { SentenceViewModel } from "../analysis/viewModels/mapSentenceToVM";
import React, { useState } from 'react';
import { ChevronRight, Settings, BookOpen, Info, Volume2 } from 'lucide-react';

interface InfoProps<T> {
    info: T;
}

export const SentenceCardComponent = (props: InfoProps<SentenceViewModel>) => {
    const className = "sentence-info-card";
    const { info } = props;
    const [isAnalysisExpanded, setIsAnalysisExpanded] = useState(true);
    const [isStructureExpanded, setIsStructureExpanded] = useState(false);

    const getRoleLabelColor = (roleLabel?: string) => {
        if (!roleLabel) return 'text-gray-600';
        if (roleLabel.includes('predicate')) return 'text-red-600';
        if (roleLabel.includes('agent')) return 'text-blue-600';
        if (roleLabel.includes('theme')) return 'text-green-600';
        if (roleLabel.includes('recipient')) return 'text-purple-600';
        return 'text-gray-600';
    };

    const getStructureBadgeColor = (structureLabel?: string) => {
        if (!structureLabel) return 'bg-gray-100 text-gray-800';
        if (structureLabel.includes('verb')) return 'bg-red-100 text-red-800';
        if (structureLabel.includes('noun')) return 'bg-blue-100 text-blue-800';
        if (structureLabel.includes('adjective')) return 'bg-green-100 text-green-800';
        if (structureLabel.includes('adverb')) return 'bg-purple-100 text-purple-800';
        return 'bg-gray-100 text-gray-800';
    };

    const getMoodColor = (mood?: string) => {
        if (!mood) return 'text-gray-600';
        if (mood.includes('positive')) return 'text-green-600';
        if (mood.includes('negative')) return 'text-red-600';
        if (mood.includes('neutral')) return 'text-gray-600';
        return 'text-orange-600';
    };

    const playPronunciation = () => {
        console.log('Playing pronunciation for:', info.text);
    };

    return (
        <div className={className}>
            <div className="w-80 bg-white rounded-lg shadow-2xl border border-gray-300"
                 style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
                
                {/* 顶部建议栏 */}
                <div className="bg-gray-100 px-4 py-2 text-sm text-gray-600 border-b border-gray-200">
                    Sentence analysis for "<strong>{info.id}</strong>" - role: "<strong>{info.roleLabel || 'unknown'}</strong>"
                </div>

                {/* 主要内容 */}
                <div className="p-3">
                    {/* 句子基本信息 */}
                    <div className="mb-5">
                        <h2 className="text-base font-medium text-gray-900 mb-2 border-b border-gray-300 pb-1">
                            Sentence Information
                        </h2>
                        
                        <div className="mb-3">
                            <div className="flex items-start gap-2 mb-2">
                                <h3 className="text-lg font-bold text-black flex-1">{info.text}</h3>
                                <button 
                                    onClick={playPronunciation}
                                    className="p-1 hover:bg-gray-100 rounded transition-colors duration-200"
                                >
                                    <Volume2 className="w-3 h-3 text-gray-600" />
                                </button>
                            </div>
                            
                            <div className="flex items-center gap-2 mb-2 text-sm text-gray-600">
                                <span>ID: <span className="font-mono">{info.id}</span></span>
                                {info.roleLabel && (
                                    <>
                                        <span>|</span>
                                        <span className={`font-medium ${getRoleLabelColor(info.roleLabel)}`}>
                                            {info.roleLabel}
                                        </span>
                                    </>
                                )}
                            </div>

                            {/* 释义 */}
                            {info.paraphrase && (
                                <p className="text-black leading-relaxed mb-2 text-sm">
                                    {info.paraphrase}
                                </p>
                            )}

                            {/* 标签显示 */}
                            <div className="flex flex-wrap gap-1 mb-2">
                                {info.roleLabel && (
                                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 border border-purple-200">
                                        {info.roleLabel}
                                    </span>
                                )}
                                {info.structureLabel && (
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getStructureBadgeColor(info.structureLabel)}`}>
                                        {info.structureLabel}
                                    </span>
                                )}
                                {info.mood && (
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 border border-orange-200 ${getMoodColor(info.mood)}`}>
                                        {info.mood}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* 语义分析部分 - 可折叠 */}
                    <div className="mb-5">
                        <button
                            onClick={() => setIsAnalysisExpanded(!isAnalysisExpanded)}
                            className="w-full flex items-center gap-2 text-base font-medium text-gray-900 mb-2 border-b border-gray-300 pb-1 hover:text-gray-700 transition-colors"
                        >
                            <div className={`transition-transform duration-200 ${isAnalysisExpanded ? 'rotate-90' : 'rotate-0'}`}>
                                <ChevronRight className="w-3 h-3" />
                            </div>
                            Semantic Analysis
                        </button>
                        
                        <div className={`transition-all duration-300 ease-in-out overflow-hidden ${
                            isAnalysisExpanded ? 'max-h-80 opacity-100' : 'max-h-0 opacity-0'
                        }`}>
                            <div className={`transform transition-transform duration-300 ${
                                isAnalysisExpanded ? 'translate-y-0' : '-translate-y-4'
                            }`}>
                                <div className="mb-3">
                                    <div className="flex items-baseline gap-2 mb-2">
                                        <h3 className="text-lg font-bold text-black">{info.text}</h3>
                                        <span className="text-gray-600">|</span>
                                        <span className="text-gray-600 text-sm">/{info.text.toLowerCase().replace(/\s+/g, '_')}/</span>
                                        <span className="text-gray-600">|</span>
                                        <span className="bg-gray-200 px-2 py-0.5 rounded text-xs text-gray-700">
                                            语义单元
                                        </span>
                                    </div>
                                    
                                    <p className="text-black mb-2 text-sm">
                                        {info.roleLabel && `角色：${info.roleLabel}。`}
                                        {info.paraphrase && `含义：${info.paraphrase}。`}
                                        {info.mood && `情感倾向：${info.mood}。`}
                                    </p>
                                </div>

                                {/* 属性详情 */}
                                <div className="bg-gray-50 p-2 rounded text-xs">
                                    <div className="font-medium text-gray-800 mb-1 flex items-center gap-1">
                                        <Info className="w-3 h-3" />
                                        Attributes:
                                    </div>
                                    <div className="space-y-1">
                                        <div className="flex justify-between">
                                            <span className="font-medium text-gray-700">Role:</span>
                                            <span className={getRoleLabelColor(info.roleLabel)}>
                                                {info.roleLabel || 'N/A'}
                                            </span>
                                        </div>
                                        {info.structureLabel && (
                                            <div className="flex justify-between">
                                                <span className="font-medium text-gray-700">Structure:</span>
                                                <span className="text-gray-600">{info.structureLabel}</span>
                                            </div>
                                        )}
                                        {info.mood && (
                                            <div className="flex justify-between">
                                                <span className="font-medium text-gray-700">Mood:</span>
                                                <span className={getMoodColor(info.mood)}>{info.mood}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 结构分析部分 - 可折叠 */}
                    {info.structureLabel && (
                        <div className="mb-5">
                            <button
                                onClick={() => setIsStructureExpanded(!isStructureExpanded)}
                                className="w-full flex items-center gap-2 text-base font-medium text-gray-900 mb-2 border-b border-gray-300 pb-1 hover:text-gray-700 transition-colors"
                            >
                                <div className={`transition-transform duration-200 ${isStructureExpanded ? 'rotate-90' : 'rotate-0'}`}>
                                    <ChevronRight className="w-3 h-3" />
                                </div>
                                Structure Analysis
                            </button>
                            
                            <div className={`transition-all duration-300 ease-in-out overflow-hidden ${
                                isStructureExpanded ? 'max-h-40 opacity-100' : 'max-h-0 opacity-0'
                            }`}>
                                <div className={`transform transition-transform duration-300 ${
                                    isStructureExpanded ? 'translate-y-0' : '-translate-y-4'
                                }`}>
                                    <div className="bg-blue-50 p-2 rounded text-xs">
                                        <div className="font-medium text-blue-900 mb-1">
                                            Structural Classification:
                                        </div>
                                        <div className="text-blue-800">
                                            <span className={`inline-block px-2 py-1 rounded ${getStructureBadgeColor(info.structureLabel)}`}>
                                                {info.structureLabel}
                                            </span>
                                            <p className="mt-1 text-blue-700">
                                                This sentence component functions as {info.structureLabel?.toLowerCase()} 
                                                in the overall sentence structure.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 底部操作栏 */}
                    <div className="space-y-2 pt-3 border-t border-gray-200">
                        <div className="flex items-center justify-between py-1 hover:bg-gray-50 rounded px-2 cursor-pointer">
                            <div className="flex items-center gap-2">
                                <BookOpen className="w-3 h-3 text-gray-600" />
                                <span className="text-gray-700 text-sm">Open in Analysis Tool</span>
                            </div>
                            <span className="text-gray-400 text-xs">⌘A</span>
                        </div>
                        
                        <div className="flex items-center justify-between py-1 hover:bg-gray-50 rounded px-2 cursor-pointer">
                            <div className="flex items-center gap-2">
                                <Settings className="w-3 h-3 text-gray-600" />
                                <span className="text-gray-700 text-sm">Configure Analysis</span>
                            </div>
                            <Settings className="w-3 h-3 text-gray-400" />
                        </div>
                    </div>
                </div>

                {/* 底部标签栏 */}
                <div className="bg-gray-200 flex rounded-b-lg overflow-hidden">
                    <button className="flex-1 py-2 text-sm text-gray-600 hover:bg-gray-300 transition-colors">
                        Context
                    </button>
                    <button className="flex-1 py-2 text-sm bg-white text-black font-medium">
                        Sentence Analysis
                    </button>
                    <button className="flex-1 py-2 text-sm text-gray-600 hover:bg-gray-300 transition-colors">
                        Export
                    </button>
                </div>
            </div>
        </div>
    );
};

export const ParagraphCardComponent = (props: InfoProps<ParagraphViewModel>) => {
    const className = "paragraph-info-card";
    
    return (
        <div className={className}>

        </div>
    )
}