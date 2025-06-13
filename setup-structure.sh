mkdir -p src/{analysis/semantic,analysis/structure,components,context,data,hooks,pages,services,styles,types}

touch src/analysis/semantic/{Sentence.ts,Paragraph.ts,RoleTagger.ts,Analyzer.ts}
touch src/analysis/structure/{Document.ts,Section.ts,TextObject.ts}
touch src/components/{TextBlock.tsx,AnnotationLayer.tsx,Sidebar.tsx}
touch src/context/{AnalysisContext.tsx,SelectionContext.tsx}
touch src/data/exampleText.json
touch src/hooks/useSemanticEngine.ts
touch src/pages/Reader.tsx
touch src/services/storage.ts
touch src/styles/theme.css
touch src/types/roles.d.ts
touch src/{App.tsx,main.tsx,index.css}