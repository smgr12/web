import React from 'react';

const TestComponent: React.FC = () => {
  return (
    <div className="min-h-screen bg-cream-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-bronze-800 mb-4">
          AutoTraderHub is Working! 🚀
        </h1>
        <p className="text-bronze-600 mb-8">
          The frontend is now loading properly.
        </p>
        <div className="space-y-4">
          <div className="p-4 bg-green-100 border border-green-200 rounded-lg">
            <p className="text-green-800">✅ React is working</p>
          </div>
          <div className="p-4 bg-blue-100 border border-blue-200 rounded-lg">
            <p className="text-blue-800">✅ Tailwind CSS is working</p>
          </div>
          <div className="p-4 bg-amber-100 border border-amber-200 rounded-lg">
            <p className="text-amber-800">✅ Custom colors are working</p>
          </div>
        </div>
        <div className="mt-8">
          <button className="bg-amber-600 text-white px-6 py-3 rounded-lg hover:bg-amber-700 transition-colors shadow-3d">
            Test Button
          </button>
        </div>
      </div>
    </div>
  );
};

export default TestComponent;