import React from 'react';

const TestComponent = () => {
  // console.log('TestComponent rendering');
  
  React.useEffect(() => {
    // console.log('TestComponent mounted');
  }, []);
  
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>🎉 React is Working!</h1>
      <p>If you can see this, React is rendering successfully.</p>
      <hr />
      <h2>Debug Information:</h2>
      <ul>
        <li>Time: {new Date().toLocaleTimeString()}</li>
        <li>React Version: {React.version}</li>
        <li>Component: TestComponent</li>
      </ul>
      <button onClick={() => alert('Button works!')}>
        Test Button Click
      </button>
    </div>
  );
};

export default TestComponent;