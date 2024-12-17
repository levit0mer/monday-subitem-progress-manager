// Helper function to calculate progress based on subitem statuses
const calculateProgress = (subitems, weights) => {
    const totalSubitems = subitems.length;
    if (totalSubitems === 0) return 0;
    
    const defaultWeights = {
      Done: 100,
      "Working On It": 50,
      Stuck: 0,
    };
  
    // Merge custom weights if provided
    const statusWeights = { ...defaultWeights, ...(weights || {}) };
  
    const progress = subitems.reduce((acc, subitem) => {
      const statusColumn = subitem.column_values.find((col) => col.id === "status");
      const status = statusColumn?.text;
      return acc + (statusWeights[status] || 0);
    }, 0);
  
    return Math.round((progress / (totalSubitems * 100)) * 100);
  };
  
module.exports = { calculateProgress };
  