<script>
  export let totalRows = 0;
  export let filteredRows = 0;
</script>

<div class="statistics-container">
  <p>Total Rows: {totalRows}</p>
  <p>Filtered Rows: {filteredRows}</p>
</div>

<style>
  .statistics-container {
    margin-top: 10px;
    padding: 10px;
    background-color: #f5f5f5;
    border: 1px solid #ccc;
    font-size: 0.9em;
    color: #1a253c;
    border-radius: 4px;
    font-family: 'Manrope', sans-serif;
  }
</style>
