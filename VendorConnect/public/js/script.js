
function searchProduct() {

    let product = document.getElementById("searchInput").value;

    let message = document.getElementById("searchMessage");

    if (product.trim() === "") {
        message.innerText = "Please enter a product name.";
        return;
    }

    message.innerText = "Searching for: " + product;

}
